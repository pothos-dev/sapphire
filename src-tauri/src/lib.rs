mod app_state;
mod bundle;
mod watcher;

use std::path::PathBuf;

use app_state::AppState;
use bundle::TreeNode;
use tauri::{Manager, State};

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

/// Resolve the Bundle root from the first positional CLI arg (default `.`),
/// then canonicalize it.
fn resolve_bundle_root() -> PathBuf {
    let arg = std::env::args().nth(1).unwrap_or_else(|| ".".to_string());
    let path = PathBuf::from(arg);
    path.canonicalize().unwrap_or(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let bundle_root = resolve_bundle_root();
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
            write_concept
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
