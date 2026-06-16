use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

use crate::index::Index;

/// How long after a self-write the watcher ignores echo events for that path.
/// Generous enough to cover the fs event round-trip, short enough that a genuine
/// external edit landing right after our write still reloads.
const SELF_WRITE_WINDOW: Duration = Duration::from_millis(1500);

/// Application state shared across Tauri commands.
///
/// Holds the canonicalized Bundle root plus a self-write tracker: the set of
/// absolute paths Emerald itself just wrote, with the instant of the write.
/// The filesystem watcher consults this to suppress echo events for our own
/// autosave writes (so they never trigger a reload loop or cursor jump), while
/// still reloading on genuine external edits. See ARCHITECTURE.md.
pub struct AppState {
    /// Canonicalized absolute path of the opened Bundle root.
    pub bundle_root: PathBuf,
    /// In-memory Bundle index (frontmatter + links + reverse map), built on
    /// startup and kept current by the watcher. Behind an `RwLock`: queries
    /// (the common case) take a shared read lock; reindexing takes a write lock.
    pub index: RwLock<Index>,
    /// Absolute path -> instant of Emerald's last write to it.
    self_writes: Mutex<HashMap<PathBuf, Instant>>,
}

impl AppState {
    pub fn new(bundle_root: PathBuf) -> Self {
        let index = Index::build(&bundle_root);
        Self {
            bundle_root,
            index: RwLock::new(index),
            self_writes: Mutex::new(HashMap::new()),
        }
    }

    /// Record that Emerald just wrote `path` (absolute). The watcher will ignore
    /// fs events for it within `SELF_WRITE_WINDOW`.
    pub fn note_self_write(&self, path: PathBuf) {
        if let Ok(mut map) = self.self_writes.lock() {
            map.insert(path, Instant::now());
        }
    }

    /// True if `path` (absolute) was written by Emerald within the suppression
    /// window. Consumes the entry on a positive match so a *subsequent* genuine
    /// external edit is not also swallowed, and prunes stale entries.
    pub fn is_recent_self_write(&self, path: &Path) -> bool {
        let Ok(mut map) = self.self_writes.lock() else {
            return false;
        };
        let now = Instant::now();
        map.retain(|_, &mut t| now.duration_since(t) < SELF_WRITE_WINDOW);
        if let Some(&t) = map.get(path) {
            if now.duration_since(t) < SELF_WRITE_WINDOW {
                map.remove(path);
                return true;
            }
        }
        false
    }
}
