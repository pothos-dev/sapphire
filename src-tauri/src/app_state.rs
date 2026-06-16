use std::path::PathBuf;

/// Application state shared across Tauri commands.
///
/// Slice 1 holds only the canonicalized Bundle root. Later slices add the
/// in-memory index handle and a self-write tracker here (see ARCHITECTURE.md).
pub struct AppState {
    /// Canonicalized absolute path of the opened Bundle root.
    pub bundle_root: PathBuf,
}

impl AppState {
    pub fn new(bundle_root: PathBuf) -> Self {
        Self { bundle_root }
    }
}
