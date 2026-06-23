//! Pure path math for link rewriting: relative-path computation, URL suffix
//! splitting, wikilink basename / shortest-resolving-suffix, and UTF-8 length.
//!
//! All bundle-relative, '/'-separated; mirrors `src/lib/links.ts` / `index.rs`
//! EXACTLY (`.`/`..` collapse, leading-`..` escapes dropped). No IO — each
//! function is a pure transform, exhaustively unit-testable.

use crate::wikilink::{self, basename, drop_md};

/// Basename (after the last `/`) of a bundle path, with `.md` dropped — the
/// literal filename to write into a rewritten wikilink (preserves new casing).
pub(super) fn basename_of(path: &str) -> &str {
    drop_md(basename(path))
}

/// The shortest path SUFFIX of `target` (a bundle path, `.md` dropped) that,
/// resolved as a wikilink against `paths`, lands back on `target`. Starts at the
/// basename and adds leading segments until resolution is unambiguous, falling
/// back to the full path. Keeps a rewritten partial-path wikilink pointing at
/// the moved file.
pub(super) fn shortest_resolving_suffix(paths: &[String], source: &str, target: &str) -> String {
    let no_ext = drop_md(target);
    let segments: Vec<&str> = no_ext.split('/').collect();
    // Try suffixes from shortest (basename) to longest (full path).
    for take in 1..=segments.len() {
        let suffix = segments[segments.len() - take..].join("/");
        if wikilink::resolve_wikilink(paths, source, &suffix).as_deref() == Some(target) {
            return suffix;
        }
    }
    // Fallback: the full path without extension (should always resolve).
    no_ext.to_string()
}

/// Split a URL into its path part and the `#anchor`/`?query` suffix (preserved
/// verbatim, including the leading `#` or `?`). The suffix begins at the first
/// `#` or `?`, whichever comes first.
pub(super) fn split_suffix(url: &str) -> (&str, &str) {
    let hash = url.find('#');
    let query = url.find('?');
    let cut = match (hash, query) {
        (Some(h), Some(q)) => Some(h.min(q)),
        (Some(h), None) => Some(h),
        (None, Some(q)) => Some(q),
        (None, None) => None,
    };
    match cut {
        Some(c) => (&url[..c], &url[c..]),
        None => (url, ""),
    }
}

/// Compute the relative path string FROM `from_dir` TO the bundle-relative
/// `target`, preferring an explicit `./` for a same-directory target and `../`
/// for ancestors (the Obsidian/markdown convention authors expect). Both inputs
/// are bundle-relative, '/'-separated; `from_dir` is '' for the bundle root.
pub(super) fn relative_path(from_dir: &str, target: &str) -> String {
    let from: Vec<&str> = if from_dir.is_empty() {
        Vec::new()
    } else {
        from_dir.split('/').collect()
    };
    let to: Vec<&str> = if target.is_empty() {
        Vec::new()
    } else {
        target.split('/').collect()
    };

    // Drop the common leading prefix.
    let mut common = 0usize;
    while common < from.len() && common < to.len() && from[common] == to[common] {
        common += 1;
    }

    let ups = from.len() - common;
    let downs = &to[common..];

    let mut parts: Vec<String> = Vec::new();
    for _ in 0..ups {
        parts.push("..".to_string());
    }
    for d in downs {
        parts.push((*d).to_string());
    }

    if parts.is_empty() {
        // target == from_dir (a directory) — should not happen for a Concept.
        return ".".to_string();
    }
    // Prefix with `./` when the path does not already start with `..` so the
    // link is unambiguously relative (matches how `./x.md` is authored).
    if parts[0] == ".." {
        parts.join("/")
    } else {
        format!("./{}", parts.join("/"))
    }
}

/// Byte length of a UTF-8 code point from its leading byte.
pub(super) fn utf8_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else if b >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_path_helper_cases() {
        assert_eq!(relative_path("", "b.md"), "./b.md");
        assert_eq!(relative_path("sub", "folder/b.md"), "../folder/b.md");
        assert_eq!(relative_path("folder", "d.md"), "../d.md");
        assert_eq!(relative_path("a/b", "a/c.md"), "../c.md");
        assert_eq!(relative_path("a", "a/c.md"), "./c.md");
        assert_eq!(relative_path("a/b/c", "x.md"), "../../../x.md");
    }
}
