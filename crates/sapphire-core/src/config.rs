//! Global config/state store in the OS app-data directory.
//!
//! Sapphire NEVER writes config or session state into the Bundle (CONTEXT.md:
//! the "no `.obsidian` equivalent" rule). Instead it keeps a single JSON file in
//! the OS config directory — `dirs::config_dir()/sapphire/state.json` (e.g.
//! `~/.config/sapphire/state.json` on Linux) — holding:
//!
//!   - app-level config (theme; only the OS-driven default ships now, but the
//!     field exists so custom themes/fonts can be read from here later), and
//!   - PER-BUNDLE session state keyed by the Bundle's ABSOLUTE path: the
//!     last-open Concept, the expanded tree folders, and the window geometry.
//!
//! The store is robust: a missing or corrupt file loads as defaults (we never
//! propagate a parse error up to the UI — losing session state is harmless).
//!
//! Pure-ish module logic — the `#[tauri::command]` wrappers in `lib.rs` stay
//! thin and just forward to `load_bundle_state` / `save_bundle_state`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Per-Bundle session state, keyed in the store by the Bundle's absolute path.
///
/// Designed to be EXTENDED without breaking older files: every field is
/// `#[serde(default)]`, so adding a field (slice 13 will add `recentFiles`) and
/// reading an older file just yields the default for the new field. Likewise an
/// older binary reading a newer file ignores unknown fields.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BundleState {
    /// Bundle-relative path of the last-open Concept, or `None` if none.
    pub last_open_concept: Option<String>,
    /// Bundle-relative paths of folders the user had expanded in the tree.
    pub expanded_folders: Vec<String>,
    /// Persisted window geometry for this Bundle (size + position), or `None`
    /// before the first save. Window handling lives in Rust (`lib.rs` setup +
    /// the window event handler) so the frontend never imports window APIs.
    pub window: Option<WindowState>,
    /// Bundle-relative paths of recently-opened Concepts, most-recent first.
    /// Deduped and capped by the frontend; round-tripped here so the quick-nav
    /// palette's recent-files list survives a relaunch.
    pub recent_files: Vec<String>,
    /// Sidebar collapse state, restored on relaunch (persist-sidebar-collapse-state).
    /// Optional so older files (lacking them) tolerate the missing fields and the
    /// frontend defaults them to `true` on read (a fresh Bundle opens expanded).
    /// Whether the left Sidebar is expanded (vs collapsed entirely).
    pub left_sidebar_open: Option<bool>,
    /// Whether the Explorer section is expanded.
    pub explorer_open: Option<bool>,
    /// Whether the Tags section is expanded.
    pub tags_open: Option<bool>,
    /// Whether the Backlinks section is expanded.
    pub backlinks_open: Option<bool>,
    /// Whether the right Sidebar (Backlinks; later Outline) is expanded
    /// (right-sidebar-move-backlinks). Defaults to `false` on the frontend — the
    /// right Sidebar starts collapsed on a fresh/older Bundle.
    pub right_sidebar_open: Option<bool>,
    /// Whether the Outline section (in the right Sidebar) is expanded
    /// (outline-section). Defaults to `true` on the frontend — the Outline shows
    /// the moment the right Sidebar is first expanded.
    pub outline_open: Option<bool>,
    /// Whether the Properties panel (editor-pane chrome) is expanded
    /// (persist-properties-collapse). Defaults to `true` on the frontend — a
    /// fresh/older Bundle opens with the panel expanded; the header chevron then
    /// persists the user's sticky choice across Concept switches and relaunches.
    pub properties_open: Option<bool>,
    /// The editor's tri-state view mode ("edit" / "hybrid" / "view"), restored on
    /// relaunch (persist-editor-mode). Optional so older files tolerate its
    /// absence; the frontend defaults it to "hybrid" (Live) on read. Carried as an
    /// opaque string here — the frontend owns the `EditorMode` union.
    pub editor_mode: Option<String>,
}

/// Saved window size and position (physical pixels). `None`-able position lets
/// the OS place a first-launch window while still restoring size.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

/// The whole on-disk store: app config plus a map of bundle-path -> state.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Store {
    /// App-level config shared across Bundles.
    pub config: AppConfig,
    /// Per-Bundle session state, keyed by the Bundle's absolute path string.
    pub bundles: HashMap<String, BundleState>,
}

/// App-level configuration (not per-Bundle). Only the OS-driven theme default
/// ships now; the field exists so future custom theme/font config can live here
/// and be read from the config folder without a schema migration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// Theme preference. `"system"` (the default) follows the OS light/dark
    /// setting; future values (`"light"`, `"dark"`, custom theme ids) can be
    /// honoured by the frontend theme store later.
    pub theme: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
        }
    }
}

/// Resolve the Sapphire config directory (`<os-config-dir>/sapphire`), creating it
/// if needed. Returns `None` if the OS config dir cannot be determined.
fn config_dir() -> Option<PathBuf> {
    let dir = dirs::config_dir()?.join("sapphire");
    // Best-effort create; if it fails we simply can't persist (load returns
    // defaults, save returns an error the caller may ignore).
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

/// Path of the single JSON state file.
fn store_path() -> Option<PathBuf> {
    Some(config_dir()?.join("state.json"))
}

/// Load the whole store from disk. Missing or corrupt file -> defaults (never
/// an error: losing session state must not break startup).
pub fn load_store() -> Store {
    let Some(path) = store_path() else {
        return Store::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Store::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// Persist the whole store to disk (pretty JSON for human inspection).
pub fn save_store(store: &Store) -> Result<(), String> {
    let path = store_path().ok_or_else(|| "no OS config directory".to_string())?;
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Normalise a Bundle root path to the string key used in the store. We use the
/// lossy string of the (already-canonicalized) root so the key is stable.
fn bundle_key(bundle_root: &Path) -> String {
    bundle_root.to_string_lossy().into_owned()
}

/// Load the session state for one Bundle (by its absolute root). Returns
/// defaults when this Bundle has never been seen.
pub fn load_bundle_state(bundle_root: &Path) -> BundleState {
    let store = load_store();
    store
        .bundles
        .get(&bundle_key(bundle_root))
        .cloned()
        .unwrap_or_default()
}

/// Save the session state for one Bundle, merging it into the store (other
/// Bundles' entries and app config are preserved).
pub fn save_bundle_state(bundle_root: &Path, state: BundleState) -> Result<(), String> {
    let mut store = load_store();
    store.bundles.insert(bundle_key(bundle_root), state);
    save_store(&store)
}

/// Read just the saved window geometry for a Bundle, if any. Used by the Tauri
/// setup to restore the window before showing it.
pub fn load_window_state(bundle_root: &Path) -> Option<WindowState> {
    load_bundle_state(bundle_root).window
}

/// Persist window geometry for a Bundle without disturbing the rest of its
/// session state. Called from the window resize/move/close handler.
pub fn save_window_state(bundle_root: &Path, window: WindowState) -> Result<(), String> {
    let mut store = load_store();
    let entry = store.bundles.entry(bundle_key(bundle_root)).or_default();
    entry.window = Some(window);
    save_store(&store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_state_defaults_are_empty() {
        let s = BundleState::default();
        assert!(s.last_open_concept.is_none());
        assert!(s.expanded_folders.is_empty());
        assert!(s.window.is_none());
        assert!(s.recent_files.is_empty());
    }

    #[test]
    fn store_round_trips_through_json_camel_case() {
        let mut store = Store::default();
        store.bundles.insert(
            "/abs/bundle".to_string(),
            BundleState {
                last_open_concept: Some("a/b.md".to_string()),
                expanded_folders: vec!["a".to_string(), "a/c".to_string()],
                window: Some(WindowState {
                    width: 800,
                    height: 600,
                    x: Some(10),
                    y: Some(20),
                }),
                recent_files: vec!["a/b.md".to_string(), "a/c.md".to_string()],
                ..Default::default()
            },
        );
        let json = serde_json::to_string(&store).unwrap();
        // camelCase keys cross the seam to match the TS types.
        assert!(json.contains("lastOpenConcept"));
        assert!(json.contains("expandedFolders"));
        assert!(json.contains("recentFiles"));
        let back: Store = serde_json::from_str(&json).unwrap();
        let st = back.bundles.get("/abs/bundle").unwrap();
        assert_eq!(st.last_open_concept.as_deref(), Some("a/b.md"));
        assert_eq!(st.expanded_folders.len(), 2);
        assert_eq!(st.window.unwrap().width, 800);
        assert_eq!(st.recent_files, vec!["a/b.md", "a/c.md"]);
    }

    #[test]
    fn corrupt_json_parses_as_default() {
        let store: Store = serde_json::from_str("{ not valid json").unwrap_or_default();
        assert!(store.bundles.is_empty());
        assert_eq!(store.config.theme, "system");
    }

    #[test]
    fn unknown_and_missing_fields_tolerated() {
        // Older file (missing window) + a future unknown field must both load.
        let json = r#"{ "lastOpenConcept": "x.md", "futureField": 42 }"#;
        let st: BundleState = serde_json::from_str(json).unwrap();
        assert_eq!(st.last_open_concept.as_deref(), Some("x.md"));
        assert!(st.window.is_none());
    }
}
