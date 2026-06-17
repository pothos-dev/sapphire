mod app_state;
mod bundle;
mod config;
mod index;
mod rewrite;
mod search;
mod watcher;

use std::path::PathBuf;

use app_state::AppState;
use bundle::TreeNode;
use config::{BundleState, WindowState};
use index::TagCount;
use rewrite::RewriteSummary;
use search::SearchHit;
use tauri::{LogicalPosition, LogicalSize, Manager, State, WindowEvent};

/// Absolute path of the opened Bundle root.
#[tauri::command]
fn bundle_root(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.bundle_root.to_string_lossy().into_owned())
}

/// Recursive directory tree of the Bundle.
#[tauri::command]
fn list_tree(state: State<'_, AppState>) -> Result<TreeNode, String> {
    bundle::list_tree(&state.bundle_root)
}

/// Raw markdown of a single Concept, by bundle-relative path.
#[tauri::command]
fn read_concept(state: State<'_, AppState>, path: String) -> Result<String, String> {
    bundle::read_concept(&state.bundle_root, &path)
}

/// Write a Concept's raw markdown back to disk (autosave). Records the write in
/// the self-write tracker so the filesystem watcher suppresses its own echo.
#[tauri::command]
fn write_concept(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    let resolved = bundle::write_concept(&state.bundle_root, &path, &content)?;
    state.note_self_write(resolved);
    Ok(())
}

/// Create a new, empty Concept (`.md`) at `path` (bundle-relative). The minimal
/// stub is an empty file; the rich frontmatter scaffold is a later slice. NOT
/// recorded as a self-write: a structural create SHOULD refresh the tree.
#[tauri::command]
fn create_concept(state: State<'_, AppState>, path: String) -> Result<(), String> {
    bundle::create_concept(&state.bundle_root, &path)?;
    Ok(())
}

/// Create a new folder (and any missing parents) at `path` (bundle-relative).
#[tauri::command]
fn create_folder(state: State<'_, AppState>, path: String) -> Result<(), String> {
    bundle::create_folder(&state.bundle_root, &path)?;
    Ok(())
}

/// Rename/move `from` to `to` (both bundle-relative). Performs the filesystem
/// rename AND automatically rewrites every link affected by the move (inbound
/// links from other Concepts, plus the moved Concept's own relative outbound
/// links — folder moves apply this to every contained Concept). Works for both
/// Concepts and folders. Returns a summary of how many links across how many
/// files were rewritten.
#[tauri::command]
fn rename_path(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<RewriteSummary, String> {
    rename_and_rewrite(&state, &from, &to)
}

/// Move `from` into the folder `toDir` (bundle-relative; '' for the root),
/// keeping the original name, then auto-rewrite affected links. Convenience over
/// `rename_path`; returns the same rewrite summary.
#[tauri::command]
fn move_path(
    state: State<'_, AppState>,
    from: String,
    to_dir: String,
) -> Result<RewriteSummary, String> {
    let name = from
        .rsplit('/')
        .find(|s| !s.is_empty())
        .ok_or_else(|| format!("invalid source path: {from}"))?;
    let to = if to_dir.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", to_dir.trim_end_matches('/'), name)
    };
    if to == from {
        return Err(format!("already in that folder: {from}"));
    }
    rename_and_rewrite(&state, &from, &to)
}

/// Shared implementation for rename + move: plan link rewrites from the CURRENT
/// index (and read source content) BEFORE the fs move, perform the fs rename,
/// then write the rewritten content to the new locations. Reindexes affected
/// Concepts immediately so backlinks / broken-link queries are prompt (the
/// watcher would also catch up asynchronously). Rewrite writes are recorded as
/// self-writes so the watcher does not echo them back as external edits.
fn rename_and_rewrite(
    state: &AppState,
    from: &str,
    to: &str,
) -> Result<RewriteSummary, String> {
    let root = &state.bundle_root;

    // 1. Plan: build the move map and read all affected source content from the
    //    CURRENT (pre-move) locations, using a snapshot of the index.
    let (moves, planned) = {
        let index = state.index.read().map_err(|e| e.to_string())?;
        let moves = rewrite::build_move_map(&index, from, to);
        let sources = rewrite::inbound_sources(&index, &moves);
        // Read content for every source we might rewrite (inbound + moved).
        let mut seen = std::collections::BTreeSet::new();
        let mut contents: Vec<(String, String)> = Vec::new();
        for s in sources.iter().chain(moves.keys()) {
            if seen.insert(s.clone()) {
                let c = bundle::read_concept(root, s)?;
                contents.push((s.clone(), c));
            }
        }
        (moves, contents)
    };

    // 2. Perform the actual filesystem rename/move.
    bundle::rename_path(root, from, to)?;

    // 3. Compute and apply rewrites against the snapshot we read in step 1.
    let lookup: std::collections::HashMap<&str, &str> = planned
        .iter()
        .map(|(p, c)| (p.as_str(), c.as_str()))
        .collect();
    let sources: Vec<String> = planned.iter().map(|(p, _)| p.clone()).collect();
    let (writes, summary) = rewrite::plan_rewrites(&moves, &sources, |p| {
        lookup
            .get(p)
            .map(|c| c.to_string())
            .ok_or_else(|| format!("missing source snapshot: {p}"))
    })?;

    // 4. Write rewritten content to the NEW locations, record self-writes, and
    //    reindex so queries are immediately consistent.
    for (new_path, content) in &writes {
        let resolved = bundle::write_concept(root, new_path, content)?;
        state.note_self_write(resolved);
        if let Ok(mut index) = state.index.write() {
            index.reindex_concept(new_path, content);
        }
    }

    Ok(summary)
}

/// Delete `path` (a Concept or a folder, recursively). The frontend confirms
/// before calling this.
#[tauri::command]
fn delete_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    bundle::delete_path(&state.bundle_root, &path)
}

/// Every Concept path in the Bundle index. The frontend seeds its synchronous
/// broken-link existence cache from this (one query instead of per-link calls).
#[tauri::command]
fn list_concept_paths(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let index = state.index.read().map_err(|e| e.to_string())?;
    Ok(index.concept_paths())
}

/// Whether a Concept exists at `path` (bundle-relative). Convenience companion
/// to `list_concept_paths`; the broken-link decoration uses the cached set.
#[tauri::command]
fn concept_exists(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    let index = state.index.read().map_err(|e| e.to_string())?;
    Ok(index.concept_exists(&path))
}

/// Sources linking TO `path` (backlinks). Used by the backlinks panel (slice 7).
#[tauri::command]
fn backlinks(state: State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    let index = state.index.read().map_err(|e| e.to_string())?;
    Ok(index.backlinks(&path))
}

/// All tags across the Bundle with per-tag counts. Used by the tags view (slice 8).
#[tauri::command]
fn all_tags(state: State<'_, AppState>) -> Result<Vec<TagCount>, String> {
    let index = state.index.read().map_err(|e| e.to_string())?;
    Ok(index.all_tags())
}

/// Concept paths carrying `tag`. Used by the tag browser (slice 8) to reveal
/// the Concepts under a selected tag.
#[tauri::command]
fn concepts_by_tag(state: State<'_, AppState>, tag: String) -> Result<Vec<String>, String> {
    let index = state.index.read().map_err(|e| e.to_string())?;
    Ok(index.concepts_by_tag(&tag))
}

/// All distinct frontmatter `type` values. Used by new-concept autocomplete (slice 12).
#[tauri::command]
fn all_types(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let index = state.index.read().map_err(|e| e.to_string())?;
    Ok(index.all_types())
}

/// All distinct top-level frontmatter keys across the Bundle. Used by the
/// Properties panel's key-name autocomplete (key-and-tag autocomplete slice);
/// the OKF recommended keys are merged in client-side.
#[tauri::command]
fn all_keys(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let index = state.index.read().map_err(|e| e.to_string())?;
    Ok(index.all_keys())
}

/// Full-text (body content) search across the Bundle, on demand. Scans every
/// `.md` Concept body with the ripgrep libraries (no external binary) and
/// returns matches (path + 1-based line + matching line snippet), ordered by
/// path then line and capped server-side. Case-insensitive literal search.
#[tauri::command]
fn search(state: State<'_, AppState>, query: String) -> Result<Vec<SearchHit>, String> {
    search::search(&state.bundle_root, &query)
}

/// Load the persisted per-Bundle session state (last-open Concept, expanded
/// folders, window geometry) for the open Bundle. Robust to a missing/corrupt
/// store: returns defaults. See `config.rs` — never written into the Bundle.
#[tauri::command]
fn load_bundle_state(state: State<'_, AppState>) -> Result<BundleState, String> {
    Ok(config::load_bundle_state(&state.bundle_root))
}

/// Persist the per-Bundle session state for the open Bundle. Merges into the
/// global store (other Bundles' entries + app config are preserved). The
/// frontend calls this (debounced) when the open Concept or expanded folders
/// change. Window geometry is owned by Rust and merged separately, so the
/// frontend's saved value here carries the window through untouched.
#[tauri::command]
fn save_bundle_state(state: State<'_, AppState>, bundle_state: BundleState) -> Result<(), String> {
    config::save_bundle_state(&state.bundle_root, bundle_state)
}

/// Capture the current window geometry into a `WindowState`. Uses logical
/// (DPI-independent) units so a restore on a differently-scaled display is sane.
fn capture_window_state(window: &tauri::WebviewWindow) -> Option<WindowState> {
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let pos = window
        .outer_position()
        .ok()
        .map(|p| p.to_logical::<f64>(scale));
    Some(WindowState {
        width: size.width.round() as u32,
        height: size.height.round() as u32,
        x: pos.map(|p| p.x.round() as i32),
        y: pos.map(|p| p.y.round() as i32),
    })
}

/// Resolve the Bundle root, then canonicalize it. Resolution order:
///   1. `EMERALD_BUNDLE` env var, if set,
///   2. the first positional CLI arg, if given,
///   3. the per-build default (see `default_bundle_root`).
fn resolve_bundle_root() -> PathBuf {
    let explicit = std::env::var("EMERALD_BUNDLE")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::args().nth(1));
    let path = explicit.map(PathBuf::from).unwrap_or_else(default_bundle_root);
    path.canonicalize().unwrap_or(path)
}

/// Default Bundle root for a DEV build: the `examples/` vault at the repo root
/// (one level up from this crate). `tauri dev` runs the binary from `src-tauri/`,
/// so a bare `.` would open the crate dir; pointing at the bundled example vault
/// makes `bun tauri dev` land in a real Bundle. Override with `EMERALD_BUNDLE`
/// or a path argument. `CARGO_MANIFEST_DIR` is the absolute `src-tauri/` path
/// baked in at compile time.
#[cfg(debug_assertions)]
fn default_bundle_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../examples")
}

/// Default Bundle root for a RELEASE build: the current working directory.
#[cfg(not(debug_assertions))]
fn default_bundle_root() -> PathBuf {
    PathBuf::from(".")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let bundle_root = resolve_bundle_root();

            // Restore the saved window geometry for this Bundle (size always;
            // position only if we have one). Window state lives in Rust so the
            // frontend never imports window APIs (ARCHITECTURE.md).
            if let Some(win) = config::load_window_state(&bundle_root) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_size(LogicalSize::new(win.width, win.height));
                    if let (Some(x), Some(y)) = (win.x, win.y) {
                        let _ = window.set_position(LogicalPosition::new(x, y));
                    }
                }
            }

            // Save window geometry on resize / move / close. We persist the
            // window slice independently of the frontend's session state so the
            // two never clobber each other.
            if let Some(window) = app.get_webview_window("main") {
                let root_for_events = bundle_root.clone();
                let window_for_events = window.clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::Resized(_)
                            | WindowEvent::Moved(_)
                            | WindowEvent::CloseRequested { .. }
                    ) {
                        if let Some(ws) = capture_window_state(&window_for_events) {
                            let _ = config::save_window_state(&root_for_events, ws);
                        }
                    }
                });
            }

            app.manage(AppState::new(bundle_root));

            // Start the filesystem watcher and keep the handle alive for the
            // app's lifetime by managing it in Tauri state.
            match watcher::start(app.handle().clone()) {
                Ok(w) => {
                    app.manage(watcher::WatcherHandle::new(w));
                }
                Err(e) => {
                    eprintln!("failed to start filesystem watcher: {e}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bundle_root,
            list_tree,
            read_concept,
            write_concept,
            create_concept,
            create_folder,
            rename_path,
            move_path,
            delete_path,
            list_concept_paths,
            concept_exists,
            backlinks,
            all_tags,
            concepts_by_tag,
            all_types,
            all_keys,
            search,
            load_bundle_state,
            save_bundle_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
