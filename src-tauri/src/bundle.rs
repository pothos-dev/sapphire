//! Bundle filesystem operations: tree walking, Concept reading, path resolution.
//!
//! Pure module logic — `#[tauri::command]` wrappers in `lib.rs` stay thin.
//! Paths crossing the seam are bundle-relative, '/'-separated, '' for root.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use ignore::WalkBuilder;
use serde::Serialize;

/// A node in the Bundle's directory tree. Matches the TS `TreeNode`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    /// bundle-relative, '/'-separated, '' for root
    pub path: String,
    pub is_dir: bool,
    /// dirs only; `None` for files so the JSON omits an empty array
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

/// Walk the Bundle and build a recursive tree, respecting ignore files
/// (`.gitignore`, etc.) via the `ignore` crate. Hidden files are excluded.
pub fn list_tree(root: &Path) -> Result<TreeNode, String> {
    // Collect every entry's bundle-relative segments, then assemble a tree.
    // We use an intermediate node map keyed by relative path for O(n) assembly.
    struct Node {
        name: String,
        path: String,
        is_dir: bool,
        children: Vec<String>, // child relative paths, dirs+files
    }

    let mut nodes: BTreeMap<String, Node> = BTreeMap::new();
    nodes.insert(
        String::new(),
        Node {
            name: root
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "bundle".to_string()),
            path: String::new(),
            is_dir: true,
            children: Vec::new(),
        },
    );

    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .parents(false)
        .build();

    for result in walker {
        let entry = result.map_err(|e| e.to_string())?;
        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rel.as_os_str().is_empty() {
            continue; // the root itself
        }

        let rel_path = to_rel_string(rel);
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir())
            .unwrap_or(false);
        let name = entry.file_name().to_string_lossy().into_owned();

        let parent = rel
            .parent()
            .map(to_rel_string)
            .unwrap_or_default();

        nodes.entry(parent.clone()).and_modify(|n| {
            n.children.push(rel_path.clone());
        });

        nodes.insert(
            rel_path.clone(),
            Node {
                name,
                path: rel_path,
                is_dir,
                children: Vec::new(),
            },
        );
    }

    fn build(key: &str, nodes: &BTreeMap<String, Node>) -> TreeNode {
        let node = &nodes[key];
        if node.is_dir {
            let mut children: Vec<TreeNode> = node
                .children
                .iter()
                .map(|child_key| build(child_key, nodes))
                .collect();
            // dirs first, then files, alphabetical
            children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            });
            TreeNode {
                name: node.name.clone(),
                path: node.path.clone(),
                is_dir: true,
                children: Some(children),
            }
        } else {
            TreeNode {
                name: node.name.clone(),
                path: node.path.clone(),
                is_dir: false,
                children: None,
            }
        }
    }

    Ok(build("", &nodes))
}

/// Read a single Concept's raw markdown by bundle-relative path, after
/// validating the path stays within the Bundle root.
pub fn read_concept(root: &Path, rel_path: &str) -> Result<String, String> {
    let resolved = resolve(root, rel_path)?;
    std::fs::read_to_string(&resolved).map_err(|e| e.to_string())
}

/// Resolve a bundle-relative path against the root, rejecting escapes
/// (`..`, absolute paths, or anything outside the Bundle).
fn resolve(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel_path);
    if rel.is_absolute() {
        return Err(format!("path must be bundle-relative: {rel_path}"));
    }
    for component in rel.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("path escapes the bundle: {rel_path}")),
        }
    }
    let joined = root.join(rel);
    // Defence in depth: canonicalize and confirm containment.
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("{rel_path}: {e}"))?;
    if !canonical.starts_with(root) {
        return Err(format!("path escapes the bundle: {rel_path}"));
    }
    Ok(canonical)
}

/// Convert a relative `Path` to a '/'-separated bundle-relative string.
fn to_rel_string(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}
