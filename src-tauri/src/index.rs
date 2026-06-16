//! In-memory Bundle index: per-Concept frontmatter + outbound internal links,
//! plus a reverse (backlink) map and aggregate tag/type sets.
//!
//! Built on startup by walking the Bundle (via the `ignore` crate, like
//! `bundle.rs`) and kept current incrementally by the filesystem watcher
//! (`watcher.rs`): a created/modified/removed Concept reindexes just that file
//! and refreshes the reverse map and aggregates.
//!
//! Link resolution mirrors `src/lib/links.ts` EXACTLY (bundle-absolute `/x.md`
//! from the root; relative `./`, `../`, or bare `x.md` against the Concept's
//! directory; external `scheme:` and pure-anchor links ignored). Keeping the
//! two in lock-step is what lets the frontend's broken-link decoration trust
//! the Rust index.
//!
//! Pure module logic — `#[tauri::command]` wrappers in `lib.rs` stay thin.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use ignore::WalkBuilder;
use serde::Serialize;

/// One Concept's indexed data: parsed frontmatter fields we care about plus its
/// outbound internal links (bundle-relative target paths).
#[derive(Debug, Clone, Default)]
pub struct ConceptEntry {
    /// `type` from the frontmatter, if present (CONTEXT.md: required, but we
    /// tolerate it missing/empty — broken Concepts are never blocked).
    pub concept_type: Option<String>,
    /// `tags` from the frontmatter (flat list); empty when absent.
    pub tags: Vec<String>,
    /// Outbound internal link targets (bundle-relative, '/'-separated).
    pub links: Vec<String>,
}

/// A tag and how many Concepts carry it. Matches the TS `{ tag, count }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

/// The in-memory index, stored in `AppState` behind a lock. Forward map keyed
/// by Concept path; reverse map (target -> sources) for backlinks; aggregates
/// recomputed from the forward map on each mutation (correct over micro-fast).
#[derive(Debug, Default)]
pub struct Index {
    /// path -> indexed entry, for every `.md` Concept in the Bundle.
    concepts: HashMap<String, ConceptEntry>,
    /// target path -> set of source paths linking TO it (backlinks).
    reverse: HashMap<String, BTreeSet<String>>,
}

impl Index {
    /// Build a fresh index by walking the Bundle root. Mirrors `bundle.rs`'s
    /// walker settings (hidden + gitignore aware) and only indexes `.md` files.
    pub fn build(root: &Path) -> Self {
        let mut index = Index::default();
        let walker = WalkBuilder::new(root)
            .hidden(true)
            .git_ignore(true)
            .git_global(false)
            .parents(false)
            .build();

        for result in walker {
            let entry = match result {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let rel = match path.strip_prefix(root) {
                Ok(r) => to_rel_string(r),
                Err(_) => continue,
            };
            if rel.is_empty() {
                continue;
            }
            let content = std::fs::read_to_string(path).unwrap_or_default();
            index.insert_concept(&rel, &content);
        }

        index.rebuild_reverse();
        index
    }

    /// Insert/replace a single Concept's parsed entry in the forward map. Does
    /// NOT touch the reverse map — call `rebuild_reverse` after a batch, or use
    /// `reindex_concept` for the incremental single-file path.
    fn insert_concept(&mut self, rel: &str, content: &str) {
        let (concept_type, tags) = parse_frontmatter(content);
        let links = extract_links(rel, content);
        self.concepts.insert(
            rel.to_string(),
            ConceptEntry {
                concept_type,
                tags,
                links,
            },
        );
    }

    /// Recompute the reverse (backlink) map from scratch from the forward map.
    fn rebuild_reverse(&mut self) {
        let mut reverse: HashMap<String, BTreeSet<String>> = HashMap::new();
        for (source, entry) in &self.concepts {
            for target in &entry.links {
                reverse
                    .entry(target.clone())
                    .or_default()
                    .insert(source.clone());
            }
        }
        self.reverse = reverse;
    }

    /// Incrementally reindex a single Concept that was created or modified.
    /// Re-parses it, replaces its forward entry, and rebuilds the reverse map.
    /// (Reverse rebuild is O(total links) — correct and simple; the Bundle is
    /// small enough that this is fine, per the ticket's "correct not micro".)
    pub fn reindex_concept(&mut self, rel: &str, content: &str) {
        self.insert_concept(rel, content);
        self.rebuild_reverse();
    }

    /// Remove a Concept that was deleted from disk. Drops its forward entry and
    /// rebuilds the reverse map so its outbound backlinks disappear. Note: other
    /// Concepts may still link TO the removed path (now a broken link) — that is
    /// tolerated and surfaced by the broken-link consumer, not erased here.
    pub fn remove_concept(&mut self, rel: &str) {
        self.concepts.remove(rel);
        self.rebuild_reverse();
    }

    /// True if a Concept exists at `path` (an exact bundle-relative key).
    pub fn concept_exists(&self, path: &str) -> bool {
        self.concepts.contains_key(path)
    }

    /// Every Concept path in the index, sorted. The broken-link decoration seeds
    /// its synchronous existence cache from this (one query at load instead of
    /// per-link round-trips).
    pub fn concept_paths(&self) -> Vec<String> {
        let mut v: Vec<String> = self.concepts.keys().cloned().collect();
        v.sort();
        v
    }

    /// Sources linking TO `path` (backlinks), sorted. Empty when none.
    pub fn backlinks(&self, path: &str) -> Vec<String> {
        self.reverse
            .get(path)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// All tags across the Bundle with per-tag Concept counts, sorted by tag.
    pub fn all_tags(&self) -> Vec<TagCount> {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for entry in self.concepts.values() {
            // De-dupe within a single Concept so a repeated tag counts once.
            let mut seen: HashSet<&str> = HashSet::new();
            for tag in &entry.tags {
                if seen.insert(tag.as_str()) {
                    *counts.entry(tag.clone()).or_default() += 1;
                }
            }
        }
        counts
            .into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect()
    }

    /// All distinct frontmatter `type` values across the Bundle, sorted.
    pub fn all_types(&self) -> Vec<String> {
        let mut set: BTreeSet<String> = BTreeSet::new();
        for entry in self.concepts.values() {
            if let Some(t) = &entry.concept_type {
                if !t.is_empty() {
                    set.insert(t.clone());
                }
            }
        }
        set.into_iter().collect()
    }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/// Parse the leading YAML frontmatter block (delimited by `---`) and extract
/// `type` (scalar) and `tags` (flat list). Tolerates missing/invalid
/// frontmatter: returns `(None, [])` rather than erroring (CONTEXT.md — broken
/// Concepts are never blocked). Unknown keys are simply ignored here (the
/// Properties panel owns verbatim round-tripping; the index only needs these).
fn parse_frontmatter(content: &str) -> (Option<String>, Vec<String>) {
    let Some(block) = frontmatter_block(content) else {
        return (None, Vec::new());
    };
    let value: serde_yaml::Value = match serde_yaml::from_str(block) {
        Ok(v) => v,
        Err(_) => return (None, Vec::new()),
    };
    let Some(map) = value.as_mapping() else {
        return (None, Vec::new());
    };

    let concept_type = map
        .get(serde_yaml::Value::from("type"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let tags = map
        .get(serde_yaml::Value::from("tags"))
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    (concept_type, tags)
}

/// Return the YAML text between the leading `---` fences, or `None` if the
/// content does not open with a frontmatter block. The block must start on the
/// very first line (`---\n`) per the OKF/Obsidian convention.
fn frontmatter_block(content: &str) -> Option<&str> {
    let rest = content.strip_prefix("---\n").or_else(|| {
        // Tolerate a leading BOM / CRLF opener.
        content.strip_prefix("---\r\n")
    })?;
    // Find the closing fence: a line that is exactly `---`.
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" {
            return Some(&rest[..offset]);
        }
        offset += line.len();
    }
    None
}

// ---------------------------------------------------------------------------
// Outbound link extraction + resolution (mirrors src/lib/links.ts)
// ---------------------------------------------------------------------------

/// Extract all internal markdown link targets from a Concept body, resolved to
/// bundle-relative paths. External (`scheme:`), pure-anchor, and empty links are
/// skipped. De-duplicated, insertion order preserved-ish (sorted for stability).
fn extract_links(current_path: &str, content: &str) -> Vec<String> {
    let body = strip_frontmatter(content);
    let mut out: BTreeSet<String> = BTreeSet::new();
    for href in markdown_link_hrefs(body) {
        if let Some(target) = resolve_internal(current_path, &href) {
            out.insert(target);
        }
    }
    out.into_iter().collect()
}

/// Strip the leading frontmatter block so a `---` or link-like text inside it is
/// not mistaken for body content.
fn strip_frontmatter(content: &str) -> &str {
    if let Some(block) = frontmatter_block(content) {
        // body starts after `---\n` + block + closing `---` line.
        // Recompute the offset robustly by locating the block within content.
        if let Some(start) = content.find(block) {
            let after_block = start + block.len();
            // Skip the closing fence line.
            if let Some(rel) = content[after_block..].find('\n') {
                return &content[after_block + rel + 1..];
            }
        }
    }
    content
}

/// Find every markdown inline-link `href`: the `target` in `[text](target)`.
/// Image links `![alt](src)` are skipped (images are not Concept links).
/// Handles a trailing `"title"` inside the parens. Reference-style links are
/// out of scope (the fixtures and OKF Concepts use inline links).
fn markdown_link_hrefs(body: &str) -> Vec<String> {
    let bytes = body.as_bytes();
    let mut hrefs = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            // Skip image links: a `!` immediately before `[`.
            let is_image = i > 0 && bytes[i - 1] == b'!';
            // Find the matching `]` (no nested brackets in OKF link text).
            if let Some(close) = find_byte(bytes, i + 1, b']') {
                // Must be immediately followed by `(`.
                if close + 1 < bytes.len() && bytes[close + 1] == b'(' {
                    if let Some(paren) = find_byte(bytes, close + 2, b')') {
                        if !is_image {
                            let raw = &body[close + 2..paren];
                            hrefs.push(extract_href(raw));
                        }
                        i = paren + 1;
                        continue;
                    }
                }
                i = close + 1;
                continue;
            }
        }
        i += 1;
    }
    hrefs
}

/// From the inside of a link's parens (`target "title"`), return just the
/// target (drop a trailing title and surrounding whitespace / angle brackets).
fn extract_href(raw: &str) -> String {
    let trimmed = raw.trim();
    // A title is ` "..."` or ` '...'` after the URL.
    let url = trimmed
        .split_once(char::is_whitespace)
        .map(|(u, _)| u)
        .unwrap_or(trimmed);
    url.trim_matches(['<', '>']).to_string()
}

fn find_byte(bytes: &[u8], from: usize, target: u8) -> Option<usize> {
    bytes[from..].iter().position(|&b| b == target).map(|p| from + p)
}

/// Resolve an `href` to a bundle-relative internal target, or `None` for
/// external / anchor / empty links. Mirrors `resolveLink` in `src/lib/links.ts`.
fn resolve_internal(current_path: &str, href: &str) -> Option<String> {
    let raw = href.trim();
    if raw.is_empty() {
        return None;
    }
    if is_external(raw) {
        return None;
    }
    if raw.starts_with('#') {
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
        let dir = match current_path.rfind('/') {
            Some(slash) => &current_path[..slash],
            None => "",
        };
        let dir_segments: Vec<&str> = if dir.is_empty() {
            Vec::new()
        } else {
            dir.split('/').collect()
        };
        let combined = dir_segments.into_iter().chain(path_part.split('/'));
        normalize_segments(combined)
    };

    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// True for `scheme:`-prefixed URLs (http, https, mailto, tel, ...). Mirrors
/// the `SCHEME_RE` in `src/lib/links.ts`.
fn is_external(href: &str) -> bool {
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
fn normalize_segments<'a>(segments: impl Iterator<Item = &'a str>) -> String {
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

/// Convert a relative `Path` to a '/'-separated bundle-relative string.
fn to_rel_string(rel: &Path) -> String {
    use std::path::Component;
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_type_and_tags() {
        let md = "---\ntype: concept\ntags: [a, b]\n---\n\n# Body\n";
        let (t, tags) = parse_frontmatter(md);
        assert_eq!(t.as_deref(), Some("concept"));
        assert_eq!(tags, vec!["a", "b"]);
    }

    #[test]
    fn tolerates_missing_frontmatter() {
        let (t, tags) = parse_frontmatter("# Just a body, no frontmatter\n");
        assert!(t.is_none());
        assert!(tags.is_empty());
    }

    #[test]
    fn tolerates_empty_type() {
        let (t, _) = parse_frontmatter("---\ntype:\ntitle: x\n---\n");
        assert!(t.is_none());
    }

    #[test]
    fn resolves_relative_and_absolute_links() {
        assert_eq!(
            resolve_internal("concepts/bundle.md", "./codemirror.md").as_deref(),
            Some("concepts/codemirror.md")
        );
        assert_eq!(
            resolve_internal("concepts/bundle.md", "/index.md").as_deref(),
            Some("index.md")
        );
        assert_eq!(
            resolve_internal("a/b/c.md", "../x.md").as_deref(),
            Some("a/x.md")
        );
    }

    #[test]
    fn ignores_external_and_anchor_links() {
        assert!(resolve_internal("a.md", "https://example.com").is_none());
        assert!(resolve_internal("a.md", "mailto:x@y.z").is_none());
        assert!(resolve_internal("a.md", "#section").is_none());
        assert!(resolve_internal("a.md", "").is_none());
    }

    #[test]
    fn extracts_links_skipping_images() {
        let body = "See [A](./a.md) and ![img](./pic.png) and [ext](https://x).";
        let links = extract_links("dir/cur.md", body);
        assert_eq!(links, vec!["dir/a.md"]);
    }

    #[test]
    fn builds_reverse_map_and_backlinks() {
        let mut idx = Index::default();
        idx.insert_concept("a.md", "[to b](/b.md)\n[to c](/c.md)");
        idx.insert_concept("b.md", "[to c](/c.md)");
        idx.insert_concept("c.md", "no links");
        idx.rebuild_reverse();
        assert_eq!(idx.backlinks("c.md"), vec!["a.md", "b.md"]);
        assert_eq!(idx.backlinks("b.md"), vec!["a.md"]);
        assert!(idx.backlinks("a.md").is_empty());
    }

    #[test]
    fn aggregates_tags_and_types() {
        let mut idx = Index::default();
        idx.insert_concept("a.md", "---\ntype: concept\ntags: [x, y]\n---\n");
        idx.insert_concept("b.md", "---\ntype: index\ntags: [x]\n---\n");
        idx.rebuild_reverse();
        let tags = idx.all_tags();
        assert_eq!(tags.len(), 2);
        let x = tags.iter().find(|t| t.tag == "x").unwrap();
        assert_eq!(x.count, 2);
        assert_eq!(idx.all_types(), vec!["concept", "index"]);
    }
}
