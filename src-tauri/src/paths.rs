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
