//! Sapphire Web's read-only HTTP server.
//!
//! A thin axum binary over `sapphire-core` — the SAME bundle/index logic the
//! Tauri desktop shell uses. It resolves a Bundle root, builds the index on
//! startup (reusing `AppState`), and serves three READ-ONLY JSON routes:
//!
//! - `GET /api/bundle-root`          → the absolute Bundle root (string)
//! - `GET /api/tree`                 → the recursive `TreeNode`
//! - `GET /api/concept?path=<rel>`   → a Concept's raw markdown (string)
//! - `GET /api/render?path=<rel>`    → rendered `{ html, frontmatter, outline }`
//! - `GET /api/events`               → SSE stream of filesystem `FileChange`s
//!
//! There is NO write path here. Every `path` crossing the seam is validated by
//! `sapphire-core` against the Bundle root (bundle-relative, forward-slash);
//! `..`/escape attempts are rejected with a 400 — this is now a genuine network
//! boundary, not just an in-process call.
//!
//! Live reload: the core `watcher` runs on startup with a sink that pushes each
//! `FileChange` into a `tokio::sync::broadcast` channel; every `/api/events`
//! connection subscribes and streams changes as SSE. Since the web app never
//! writes, there is nothing to suppress — every change is a genuine external
//! edit worth delivering to all connected browsers.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use sapphire_core::app_state::AppState;
use sapphire_core::bundle::{self, TreeNode};
use sapphire_core::render::{self, RenderPayload};
use sapphire_core::watcher::{self, FileChange};

/// Default HTTP port. Overridable via `SAPPHIRE_API_PORT`.
const DEFAULT_PORT: u16 = 8787;

/// Capacity of the filesystem-change broadcast channel. A slow SSE consumer that
/// falls this far behind sees a lag error (skipped, not fatal).
const EVENTS_CHANNEL_CAP: usize = 256;

/// Shared server state: the domain `AppState` (bundle root + index) plus the
/// broadcast sender every `/api/events` connection subscribes to.
struct ServerState {
    app: Arc<AppState>,
    events: broadcast::Sender<FileChange>,
}

#[tokio::main]
async fn main() {
    let root = resolve_bundle_root();
    eprintln!("sapphire-server: serving bundle {}", root.display());

    // Reuse the desktop's AppState (canonical root + in-memory index built on
    // startup); the index is kept current by the watcher below.
    let app_state = Arc::new(AppState::new(root.clone()));

    // Broadcast filesystem changes to every connected SSE client. The core
    // watcher is host-agnostic: it hands us each `FileChange` through a sink;
    // our sink fans it out over the broadcast channel. No self-write
    // suppression matters here — the web server never writes.
    let (events, _) = broadcast::channel::<FileChange>(EVENTS_CHANNEL_CAP);
    let sink_tx = events.clone();
    // Kept bound (NOT dropped) for the process lifetime so watching continues.
    let _watcher = match watcher::start(root, app_state.clone(), move |change| {
        // Err only means "no subscribers right now" — fine to ignore.
        let _ = sink_tx.send(change);
    }) {
        Ok(w) => Some(watcher::WatcherHandle::new(w)),
        Err(e) => {
            eprintln!("sapphire-server: filesystem watcher failed to start: {e}");
            None
        }
    };

    let state = Arc::new(ServerState {
        app: app_state,
        events,
    });
    let app = router(state);

    let port = std::env::var("SAPPHIRE_API_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    eprintln!("sapphire-server: listening on http://{addr}");
    axum::serve(listener, app).await.expect("server error");
}

/// Build the read-only route table over a `ServerState`.
fn router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/api/bundle-root", get(bundle_root_handler))
        .route("/api/tree", get(tree_handler))
        .route("/api/concept", get(concept_handler))
        .route("/api/render", get(render_handler))
        .route("/api/events", get(events_handler))
        .with_state(state)
}

// --- Routes -----------------------------------------------------------------

async fn bundle_root_handler(State(state): State<Arc<ServerState>>) -> Json<String> {
    Json(state.app.bundle_root.to_string_lossy().into_owned())
}

async fn tree_handler(State(state): State<Arc<ServerState>>) -> Result<Json<TreeNode>, ApiError> {
    bundle::list_tree(&state.app.bundle_root)
        .map(Json)
        .map_err(ApiError::from_core)
}

#[derive(Deserialize)]
struct ConceptQuery {
    path: String,
}

async fn concept_handler(
    State(state): State<Arc<ServerState>>,
    Query(q): Query<ConceptQuery>,
) -> Result<Json<String>, ApiError> {
    bundle::read_concept(&state.app.bundle_root, &q.path)
        .map(Json)
        .map_err(ApiError::from_core)
}

async fn render_handler(
    State(state): State<Arc<ServerState>>,
    Query(q): Query<ConceptQuery>,
) -> Result<Json<RenderPayload>, ApiError> {
    // Resolve links against the in-memory index. The read lock is held only for
    // the render call; a poisoned lock is a 500.
    let index = state
        .app
        .read_index()
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    render::render_concept(&state.app.bundle_root, &index, &q.path)
        .map(Json)
        .map_err(ApiError::from_core)
}

/// Stream filesystem changes as Server-Sent Events. Each connection subscribes
/// to the broadcast channel; changes arrive as SSE `message` events with a JSON
/// `FileChange` payload. A lagging subscriber's dropped items are skipped (not
/// fatal). Dropping the receiver on client disconnect is automatic (the stream
/// is tied to the response future). A keep-alive comment holds idle connections
/// open through proxies.
async fn events_handler(
    State(state): State<Arc<ServerState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.events.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|res| match res {
        Ok(change) => Event::default().json_data(&change).ok().map(Ok),
        // Lagged (slow consumer) — skip the missed items rather than error out.
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// --- Error mapping ----------------------------------------------------------

/// An error crossing the HTTP boundary: a status + a message. `sapphire-core`
/// returns stringly-typed errors; we classify them into 4xx codes so a path
/// escape is a `400 Bad Request` (a client mistake / attack) while a missing
/// Concept is a `404 Not Found`.
struct ApiError(StatusCode, String);

impl ApiError {
    fn from_core(msg: String) -> Self {
        ApiError(classify(&msg), msg)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}

/// Map a `sapphire-core` error string to an HTTP status. Path-escape / invalid
/// path errors are the caller's fault (a real network boundary now guards
/// them) → `400`; everything else (a genuinely missing/unreadable file) → `404`.
fn classify(msg: &str) -> StatusCode {
    if msg.contains("escapes the bundle") || msg.contains("must be bundle-relative") {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::NOT_FOUND
    }
}

// --- Bundle root resolution -------------------------------------------------

/// Resolve the Bundle root: `SAPPHIRE_BUNDLE` if set, else the repo `examples/`
/// dir (a sensible dev default). Canonicalized so `sapphire-core`'s containment
/// check (`resolve` confirms the target stays under the canonical root) holds.
fn resolve_bundle_root() -> PathBuf {
    let explicit = std::env::var("SAPPHIRE_BUNDLE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);
    let path = explicit.unwrap_or_else(default_dev_root);
    path.canonicalize().unwrap_or(path)
}

/// Dev fallback Bundle: the repo's `examples/` directory, relative to this
/// crate. Lets `cargo run -p sapphire-server` open a real Bundle out of the box.
fn default_dev_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A throwaway canonicalized bundle root under the OS temp dir, seeded with
    /// one Concept so the happy-path routes have something to read.
    fn temp_bundle() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "sapphire-server-{}-{}",
            std::process::id(),
            n
        ));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("note.md"), "# Hello\n\nbody").unwrap();
        std::fs::write(dir.join("sub/deep.md"), "deep").unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn classify_escape_is_400_missing_is_404() {
        assert_eq!(classify("path escapes the bundle: ../x"), StatusCode::BAD_REQUEST);
        assert_eq!(
            classify("path must be bundle-relative: /abs"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            classify("../x: No such file or directory"),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn tree_route_returns_the_bundle_tree() {
        let root = temp_bundle();
        let tree = bundle::list_tree(&root).unwrap();
        assert!(tree.is_dir);
        assert_eq!(tree.path, "");
        let children = tree.children.unwrap();
        let names: Vec<&str> = children.iter().map(|c| c.name.as_str()).collect();
        // dirs first, then files: "sub" then "note.md".
        assert_eq!(names, vec!["sub", "note.md"]);
    }

    #[test]
    fn concept_route_reads_raw_markdown() {
        let root = temp_bundle();
        let content = bundle::read_concept(&root, "note.md").unwrap();
        assert_eq!(content, "# Hello\n\nbody");
        assert_eq!(bundle::read_concept(&root, "sub/deep.md").unwrap(), "deep");
    }

    #[test]
    fn concept_route_rejects_path_escape_with_400() {
        let root = temp_bundle();
        // A `..` escape and an absolute path both fail core validation, and the
        // server maps both to a 400 (a client / attack mistake at the boundary).
        let err = bundle::read_concept(&root, "../secret.md").unwrap_err();
        assert_eq!(classify(&err), StatusCode::BAD_REQUEST);
        let err = bundle::read_concept(&root, "/etc/passwd").unwrap_err();
        assert_eq!(classify(&err), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn router_builds_over_server_state() {
        // Smoke: constructing the router with a real ServerState (index built on
        // startup + a broadcast sender) must not panic.
        let root = temp_bundle();
        let (events, _) = broadcast::channel::<FileChange>(8);
        let _app = router(Arc::new(ServerState {
            app: Arc::new(AppState::new(root)),
            events,
        }));
    }

    #[tokio::test]
    async fn broadcast_fans_a_change_out_to_every_subscriber() {
        // The SSE wiring: a change sent on the broadcast sender reaches every
        // subscribed receiver (each SSE connection is one subscriber).
        let (tx, _) = broadcast::channel::<FileChange>(8);
        let mut a = tx.subscribe();
        let mut b = tx.subscribe();
        let change = FileChange {
            kind: "modified".to_string(),
            paths: vec!["note.md".to_string()],
        };
        tx.send(change).unwrap();
        let ra = a.recv().await.unwrap();
        let rb = b.recv().await.unwrap();
        assert_eq!(ra.kind, "modified");
        assert_eq!(ra.paths, vec!["note.md".to_string()]);
        assert_eq!(rb.paths, ra.paths);
    }

    #[test]
    fn render_route_returns_html_frontmatter_and_outline() {
        // A bundle with a Concept that links to a sibling that exists.
        let root = temp_bundle();
        std::fs::write(
            root.join("note.md"),
            "---\ntype: concept\n---\n# Hello\n\nSee [deep](sub/deep.md).\n",
        )
        .unwrap();
        let index = sapphire_core::index::Index::build(&root);
        let payload = render::render_concept(&root, &index, "note.md").unwrap();
        assert!(payload.html.contains("<h1>"));
        assert!(payload.html.contains("<p>"));
        // The in-bundle link resolves to an internal nav anchor.
        assert!(payload.html.contains(r#"class="internal-link""#));
        assert!(payload.html.contains(r#"data-path="sub/deep.md""#));
        assert_eq!(payload.outline.len(), 1);
        assert_eq!(payload.outline[0].text, "Hello");
        assert_eq!(payload.frontmatter[0].key, "type");
    }

    #[test]
    fn render_route_rejects_path_escape_with_400() {
        let root = temp_bundle();
        let index = sapphire_core::index::Index::build(&root);
        let err = render::render_concept(&root, &index, "../secret.md").unwrap_err();
        assert_eq!(classify(&err), StatusCode::BAD_REQUEST);
    }
}
