//! Filesystem watcher: a `notify` recursive watcher over the Bundle root that
//! emits a Tauri event to the frontend when files change on disk.
//!
//! Self-write suppression lives here: before emitting, each changed path is
//! checked against `AppState`'s self-write tracker. Paths Sapphire just wrote
//! (autosave) are swallowed, so our own writes never cause a reload loop or
//! cursor jump. Genuine external edits still emit and the frontend reloads.
//!
//! Pure-ish module logic — `lib.rs` just calls `start` in setup.

use std::path::{Component, Path};
use std::sync::Arc;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::AppState;

/// Event name emitted to the frontend on a (non-self) filesystem change.
pub const FILE_CHANGED_EVENT: &str = "file-changed";

/// Payload of a `file-changed` event. `paths` are bundle-relative,
/// '/'-separated. Matches the TS `FileChange` type across the IPC seam.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// What happened: "created" | "modified" | "removed".
    pub kind: String,
    /// Affected bundle-relative paths.
    pub paths: Vec<String>,
}

/// Start watching the Bundle root recursively. The returned watcher must be
/// kept alive (managed in `AppState` / a long-lived owner) or watching stops.
pub fn start(app: AppHandle) -> Result<RecommendedWatcher, String> {
    let state = app.state::<AppState>();
    let root = state.bundle_root.clone();
    let app_for_cb = app.clone();

    let mut watcher = notify::recommended_watcher(
        move |res: notify::Result<notify::Event>| {
            let event = match res {
                Ok(e) => e,
                Err(_) => return,
            };
            handle_event(&app_for_cb, event);
        },
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(watcher)
}

/// Translate a notify event into a `file-changed` emit, applying self-write
/// suppression and path-to-bundle-relative conversion.
fn handle_event(app: &AppHandle, event: notify::Event) {
    let kind = match classify(&event.kind) {
        Some(k) => k,
        None => return, // access/other events are noise for the UI
    };

    let state = app.state::<AppState>();
    let root = &state.bundle_root;

    let mut rel_paths: Vec<String> = Vec::new();
    for abs in &event.paths {
        let Some(rel) = to_bundle_relative(root, abs) else {
            continue;
        };

        // Keep the index current for EVERY change, including Sapphire's own
        // autosave writes — the index must reflect on-disk truth regardless of
        // who wrote it. (Only the *frontend event* is suppressed for self
        // writes, below, to avoid reload loops / cursor jumps.)
        if rel.ends_with(".md") {
            update_index(&state, &rel, abs, kind);
        }

        // Suppress Sapphire's own writes for the frontend echo.
        if state.is_recent_self_write(abs) {
            continue;
        }
        rel_paths.push(rel);
    }

    if rel_paths.is_empty() {
        return;
    }

    let payload = FileChange {
        kind: kind.to_string(),
        paths: rel_paths,
    };
    let _ = app.emit(FILE_CHANGED_EVENT, payload);
}

/// Apply a single Concept change to the in-memory index. Created/modified read
/// the new content from disk and reindex; removed drops the entry. Mirrors the
/// startup build so the index stays correct without a restart. Lock-poison and
/// transient read errors are tolerated (the index is best-effort; a stale entry
/// never blocks editing — broken links are tolerated by design).
fn update_index(state: &AppState, rel: &str, abs: &Path, kind: &str) {
    let Ok(mut index) = state.index.write() else {
        return;
    };
    match kind {
        "removed" => index.remove_concept(rel),
        _ => {
            // created | modified: re-read and reindex. If the read fails (e.g. a
            // create event for a file already gone), treat it as a removal.
            match std::fs::read_to_string(abs) {
                Ok(content) => index.reindex_concept(rel, &content),
                Err(_) => index.remove_concept(rel),
            }
        }
    }
}

/// Map a notify `EventKind` to our coarse "created"/"modified"/"removed"
/// vocabulary, or `None` for events the UI does not care about.
fn classify(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("removed"),
        _ => None,
    }
}

/// Convert an absolute path under the Bundle root into a '/'-separated
/// bundle-relative string. Returns `None` if the path is outside the root.
fn to_bundle_relative(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let s = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Hold the watcher alive for the lifetime of the app. We wrap it so `lib.rs`
/// can stash it without naming the concrete watcher type everywhere.
pub struct WatcherHandle(#[allow(dead_code)] Arc<RecommendedWatcher>);

impl WatcherHandle {
    pub fn new(watcher: RecommendedWatcher) -> Self {
        WatcherHandle(Arc::new(watcher))
    }
}

/// Debounce hint (documented for the frontend; not enforced here): notify can
/// fire multiple events per logical change. The frontend coalesces tree
/// refreshes. Kept as a constant in case we add server-side debouncing.
#[allow(dead_code)]
pub const COALESCE_HINT: Duration = Duration::from_millis(50);
