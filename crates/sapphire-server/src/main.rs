//! Sapphire Web's read-only HTTP server.
//!
//! A thin axum binary over `sapphire-core` — the SAME bundle/index logic the
//! Tauri desktop shell uses. It resolves a Bundle root, builds the index on
//! startup (reusing `AppState`), and serves three READ-ONLY JSON routes:
//!
//! - `GET /api/bundle-root`          → the absolute Bundle root (string)
//! - `GET /api/tree`                 → the recursive `TreeNode`
//! - `GET /api/concept?path=<rel>`   → a Concept's raw markdown (string)
//!
//! There is NO write path here. Every `path` crossing the seam is validated by
//! `sapphire-core` against the Bundle root (bundle-relative, forward-slash);
//! `..`/escape attempts are rejected with a 400 — this is now a genuine network
//! boundary, not just an in-process call.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use sapphire_core::app_state::AppState;
use sapphire_core::bundle::{self, TreeNode};

/// Default HTTP port. Overridable via `SAPPHIRE_API_PORT`.
const DEFAULT_PORT: u16 = 8787;

#[tokio::main]
async fn main() {
    let root = resolve_bundle_root();
    eprintln!("sapphire-server: serving bundle {}", root.display());

    // Reuse the desktop's AppState (canonical root + in-memory index built on
    // startup). Slices 5/6 will read `state.index` for sidebars + search.
    let state = Arc::new(AppState::new(root));

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

/// Build the read-only route table over an `AppState`.
fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/bundle-root", get(bundle_root_handler))
        .route("/api/tree", get(tree_handler))
        .route("/api/concept", get(concept_handler))
        .with_state(state)
}

// --- Routes -----------------------------------------------------------------

async fn bundle_root_handler(State(state): State<Arc<AppState>>) -> Json<String> {
    Json(state.bundle_root.to_string_lossy().into_owned())
}

async fn tree_handler(State(state): State<Arc<AppState>>) -> Result<Json<TreeNode>, ApiError> {
    bundle::list_tree(&state.bundle_root)
        .map(Json)
        .map_err(ApiError::from_core)
}

#[derive(Deserialize)]
struct ConceptQuery {
    path: String,
}

async fn concept_handler(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ConceptQuery>,
) -> Result<Json<String>, ApiError> {
    bundle::read_concept(&state.bundle_root, &q.path)
        .map(Json)
        .map_err(ApiError::from_core)
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
    fn router_builds_over_app_state() {
        // Smoke: constructing the router with a real AppState (index built on
        // startup) must not panic.
        let root = temp_bundle();
        let _app = router(Arc::new(AppState::new(root)));
    }
}
