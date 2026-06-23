//! Leading YAML frontmatter parsing for the Bundle index.
//!
//! Extracts only the aggregates the index needs (`type`, `tags`, and the
//! distinct top-level keys) and exposes the block-finding / stripping helpers
//! the link extractor reuses. The Properties panel owns verbatim
//! round-tripping; broken/invalid frontmatter is tolerated, never blocked
//! (CONTEXT.md).

/// The frontmatter fields the index cares about, parsed from a Concept's leading
/// YAML block.
#[derive(Debug, Default, Clone)]
pub(super) struct ParsedFrontmatter {
    /// `type` scalar, if present and non-empty.
    pub(super) concept_type: Option<String>,
    /// `tags` flat list; empty when absent.
    pub(super) tags: Vec<String>,
    /// Distinct top-level frontmatter keys.
    pub(super) keys: Vec<String>,
}

/// Parse the leading YAML frontmatter block (delimited by `---`) and extract
/// `type` (scalar), `tags` (flat list), and the distinct top-level keys.
/// Tolerates missing/invalid frontmatter: returns a default (all-empty)
/// `ParsedFrontmatter` rather than erroring (CONTEXT.md — broken Concepts are
/// never blocked).
pub(super) fn parse_frontmatter(content: &str) -> ParsedFrontmatter {
    let Some(block) = frontmatter_block(content) else {
        return ParsedFrontmatter::default();
    };
    let value: serde_yaml::Value = match serde_yaml::from_str(block) {
        Ok(v) => v,
        Err(_) => return ParsedFrontmatter::default(),
    };
    let Some(map) = value.as_mapping() else {
        return ParsedFrontmatter::default();
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

    let keys = map
        .keys()
        .filter_map(|k| k.as_str().map(|s| s.to_string()))
        .collect();

    ParsedFrontmatter {
        concept_type,
        tags,
        keys,
    }
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

/// Strip the leading frontmatter block so a `---` or link-like text inside it is
/// not mistaken for body content.
pub(super) fn strip_frontmatter(content: &str) -> &str {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_type_and_tags() {
        let md = "---\ntype: concept\ntags: [a, b]\n---\n\n# Body\n";
        let fm = parse_frontmatter(md);
        assert_eq!(fm.concept_type.as_deref(), Some("concept"));
        assert_eq!(fm.tags, vec!["a", "b"]);
        assert_eq!(fm.keys, vec!["type", "tags"]);
    }

    #[test]
    fn tolerates_missing_frontmatter() {
        let fm = parse_frontmatter("# Just a body, no frontmatter\n");
        assert!(fm.concept_type.is_none());
        assert!(fm.tags.is_empty());
        assert!(fm.keys.is_empty());
    }

    #[test]
    fn tolerates_empty_type() {
        let fm = parse_frontmatter("---\ntype:\ntitle: x\n---\n");
        assert!(fm.concept_type.is_none());
        // Even when `type` is empty, its KEY is still present (autocomplete).
        assert_eq!(fm.keys, vec!["type", "title"]);
    }
}
