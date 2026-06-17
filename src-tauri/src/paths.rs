//! Shared bundle-path and filesystem-walk helpers.
//!
//! Consolidates logic that was previously duplicated across `bundle.rs`,
//! `index.rs`, `search.rs`, and `rewrite.rs`: the canonical Bundle file walker
//! and bundle-relative path conversion. Keeping a single copy guarantees the
//! tree walk, the index build, and full-text search agree on which files are
//! part of the Bundle.

use std::path::{Component, Path};

use ignore::WalkBuilder;

/// The canonical Bundle file walker: skips hidden files, honors the Bundle's
/// own `.gitignore`, and ignores global/parent gitignore so traversal depends
/// only on the Bundle's contents. Every traversal (tree, index, search) builds
/// from this so they cannot drift apart. Caller appends `.build()`.
pub fn bundle_walker(root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .parents(false);
    builder
}

/// Convert a path already relative to the Bundle root into a '/'-separated
/// bundle-relative string, dropping any non-`Normal` components.
pub fn to_rel_string(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

// --- Markdown link resolution -------------------------------------------------
//
// These mirror `src/lib/links.ts` on the frontend (the fake backend ports the
// same logic). They are shared by `index.rs` (extracting outbound links) and
// `rewrite.rs` (rewriting links on move/rename) so the two cannot diverge.

/// Index of the first `target` byte at or after `from`, if any.
pub fn find_byte(bytes: &[u8], from: usize, target: u8) -> Option<usize> {
    bytes[from..]
        .iter()
        .position(|&b| b == target)
        .map(|p| from + p)
}

/// Directory portion of a bundle-relative path ('' for a root-level file).
pub fn dir_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(slash) => &path[..slash],
        None => "",
    }
}

/// True for `scheme:`-prefixed URLs (http, https, mailto, tel, ...). Mirrors
/// the `SCHEME_RE` in `src/lib/links.ts`.
pub fn is_external(href: &str) -> bool {
    let bytes = href.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    for (i, &b) in bytes.iter().enumerate() {
        if b == b':' {
            return i > 0;
        }
        let ok = b.is_ascii_alphanumeric() || matches!(b, b'+' | b'.' | b'-');
        if !ok {
            return false;
        }
    }
    false
}

/// Collapse `.`/`..` segments. Leading `..` that would escape the root are
/// dropped (matching the backend's escape rejection and `links.ts`).
pub fn normalize_segments<'a>(segments: impl Iterator<Item = &'a str>) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in segments {
        match seg {
            "" | "." => continue,
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    out.join("/")
}

/// Resolve an `href` to a bundle-relative internal target, or `None` for
/// external / anchor / empty links. A trailing `#anchor` or `?query` is dropped
/// (so a path part already split of its suffix passes through unchanged).
/// Mirrors `resolveLink` in `src/lib/links.ts`.
pub fn resolve_internal(current_path: &str, href: &str) -> Option<String> {
    let raw = href.trim();
    if raw.is_empty() || is_external(raw) || raw.starts_with('#') {
        return None;
    }
    // Drop a trailing `#anchor` and `?query`.
    let path_part = raw.split('#').next().unwrap_or("");
    let path_part = path_part.split('?').next().unwrap_or("");
    if path_part.is_empty() {
        return None;
    }

    let path = if let Some(stripped) = path_part.strip_prefix('/') {
        // Bundle-absolute: resolve from the root.
        normalize_segments(stripped.split('/'))
    } else {
        // Relative: resolve against the current Concept's directory.
        let dir = dir_of(current_path);
        let dir_segments: Vec<&str> = if dir.is_empty() {
            Vec::new()
        } else {
            dir.split('/').collect()
        };
        normalize_segments(dir_segments.into_iter().chain(path_part.split('/')))
    };

    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}
