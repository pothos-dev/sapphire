//! Server-side Concept rendering (slice: web-server-side-render).
//!
//! Renders a Concept's markdown BODY to read-only HTML for the web viewer, so
//! all knowledge semantics stay in Rust (no CodeMirror on the web). The BODY
//! only is rendered — frontmatter lives outside the document (ADR 0003) and is
//! returned separately for the read-only Properties view.
//!
//! Link resolution REUSES the existing core logic — `paths::resolve_internal`
//! for standard markdown links and `wikilink::resolve_wikilink` for `[[name]]`
//! wikilinks — so the web resolves links by the exact same rules as the desktop
//! (filename match, shortest-path/alphabetical tie-break, suffix match). The
//! rules are not reimplemented here; we only decide, per resolved target, how it
//! is emitted:
//!   - in-Bundle & existing  → `class="internal-link" data-path=… href="?path=…"`
//!     (the viewer intercepts the click and navigates WITHIN the app),
//!   - in-Bundle & missing   → the same plus `broken` (styled distinct, still
//!     present and clickable — broken links are tolerated per OKF),
//!   - external (`scheme:`)  → a normal anchor opening in a new tab.
//!
//! Pipeline: strip frontmatter → rewrite `[[wikilinks]]` to markdown links
//! carrying a resolution marker → parse with comrak → mark standard-link URLs
//! with the same markers (+ collect the heading outline) → render HTML → rewrite
//! the marker hrefs into the final anchor attributes.
//!
//! Mermaid fenced blocks are left as inert `<pre><code>` source here; their
//! client-side hydration is a later slice.

use std::collections::HashMap;
use std::path::Path;

use comrak::nodes::NodeValue;
use comrak::{format_html, parse_document, Arena, Options};
use regex::Regex;
use serde::Serialize;

use crate::bundle;
use crate::index::frontmatter::{frontmatter_block, strip_frontmatter};
use crate::index::Index;
use crate::paths::{is_external, resolve_internal};
use crate::slug::slugify;
use crate::wikilink::{self, parse_target};

/// The rendered read-only view of a Concept: body HTML plus the parsed
/// frontmatter and the document outline. Matches the TS shape consumed by the
/// web viewer (`serde rename_all = "camelCase"`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPayload {
    /// Rendered body HTML (frontmatter excluded).
    pub html: String,
    /// Frontmatter key → value(s), in document order (for the Properties view).
    pub frontmatter: Vec<FrontmatterField>,
    /// Headings in document order (frontmatter + fenced code excluded).
    pub outline: Vec<OutlineHeading>,
}

/// One frontmatter entry for the read-only Properties view. A scalar has a
/// single value; a sequence (e.g. `tags`) has several.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterField {
    pub key: String,
    pub values: Vec<String>,
}

/// One outline heading: level (1–6), text, and its de-duplicated GitHub slug.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineHeading {
    pub level: u8,
    pub text: String,
    pub slug: String,
}

/// Render the Concept at `rel_path` (validated against the Bundle root, like the
/// other read routes) to a [`RenderPayload`], resolving links against `index`.
pub fn render_concept(
    root: &Path,
    index: &Index,
    rel_path: &str,
) -> Result<RenderPayload, String> {
    // read_concept validates the path (escape rejection) and reads the raw file.
    let content = bundle::read_concept(root, rel_path)?;
    let all_paths = index.concept_paths();
    Ok(render_body(&content, rel_path, &all_paths, &|p| {
        index.concept_exists(p)
    }))
}

/// Pure render over raw Concept `content` (frontmatter included). `source_path`
/// is the Concept's own path (for relative links / `[[#anchor]]`); `all_paths`
/// is every Concept path in the Bundle (for name-based wikilink resolution);
/// `exists` reports whether a resolved path is a real Concept (for broken-link
/// marking). Split out from `render_concept` so it is testable without disk.
pub fn render_body(
    content: &str,
    source_path: &str,
    all_paths: &[String],
    exists: &dyn Fn(&str) -> bool,
) -> RenderPayload {
    let frontmatter = frontmatter_fields(content);
    let body = strip_frontmatter(content);

    // 1. Rewrite `[[wikilinks]]` to markdown links carrying a resolution marker
    //    URL, so comrak parses them as ordinary links we finish uniformly below.
    let prepared = wikilink::replace_wikilinks(body, |raw| {
        wikilink_to_markdown(raw, source_path, all_paths, exists)
    });

    // 2. Parse + walk: collect the heading outline, and mark standard-link URLs.
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    // Leave `render.unsafe_` false: raw HTML in the body is escaped (read-only,
    // no XSS). We inject nothing as raw HTML — link markers ride in hrefs.
    let root = parse_document(&arena, &prepared, &options);

    let mut headings: Vec<(u8, String)> = Vec::new();
    for node in root.descendants() {
        let level = match &node.data.borrow().value {
            NodeValue::Heading(h) => h.level,
            _ => continue,
        };
        headings.push((level, node_text(node)));
    }

    for node in root.descendants() {
        let mut data = node.data.borrow_mut();
        if let NodeValue::Link(link) = &mut data.value {
            link.url = mark_link_url(&link.url, source_path, all_paths, exists);
        }
    }

    let outline = build_outline(headings);

    let mut buf = Vec::new();
    format_html(root, &options, &mut buf).expect("comrak html formatting");
    // Add `id="<slug>"` to each heading (in document order, matching the outline
    // slugs) so the Outline section can scroll the rendered view to a heading.
    let html = inject_heading_ids(&String::from_utf8_lossy(&buf), &outline);
    let html = rewrite_marker_hrefs(&html);

    RenderPayload {
        html,
        frontmatter,
        outline,
    }
}

/// Add `id="<slug>"` to every heading open tag (`<h1>`…`<h6>`) comrak emitted,
/// in document order, from the (de-duplicated) `outline` slugs. comrak emits
/// bare heading tags; headings and the outline are both in document order, so
/// the k-th `<hN>` gets the k-th outline slug — the anchor the Outline links to.
fn inject_heading_ids(html: &str, outline: &[OutlineHeading]) -> String {
    let re = Regex::new(r"<(h[1-6])>").unwrap();
    let mut idx = 0usize;
    re.replace_all(html, |caps: &regex::Captures| {
        let tag = &caps[1];
        let out = match outline.get(idx) {
            Some(h) if !h.slug.is_empty() => format!(r#"<{tag} id="{}">"#, attr_escape(&h.slug)),
            _ => format!("<{tag}>"),
        };
        idx += 1;
        out
    })
    .into_owned()
}

// --- Link marking -----------------------------------------------------------

const M_INTERNAL: &str = "sapint:";
const M_BROKEN: &str = "sapbroken:";
const M_EXTERNAL: &str = "sapext:";

/// Convert one wikilink inner text (`[[ raw ]]`) into markdown-link syntax whose
/// destination carries a resolution marker. Reuses `resolve_wikilink` (name
/// rules), so a resolved target is `sapint:PATH`, an unresolved one `sapbroken:`.
fn wikilink_to_markdown(
    raw: &str,
    source_path: &str,
    all_paths: &[String],
    exists: &dyn Fn(&str) -> bool,
) -> String {
    let target = parse_target(raw);
    // Obsidian shows the alias if present, else the name (or the bare anchor for
    // a pure `[[#heading]]`).
    let display = target
        .alias
        .clone()
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| {
            if target.name.is_empty() {
                target
                    .anchor
                    .clone()
                    .map(|a| format!("#{a}"))
                    .unwrap_or_default()
            } else {
                target.name.clone()
            }
        });

    let marker = match wikilink::resolve_wikilink(all_paths, source_path, raw) {
        // A resolved target that (defensively) also exists is internal; a
        // resolved-but-missing path is broken (same treatment as markdown links).
        Some(path) if exists(&path) => format!("{M_INTERNAL}{path}"),
        Some(path) => format!("{M_BROKEN}{path}"),
        None => format!("{M_BROKEN}{}", target.name),
    };

    // Angle-bracket destination tolerates spaces in the marker/path.
    format!("[{}](<{}>)", escape_link_text(&display), marker)
}

/// Decide the marker URL for a STANDARD markdown link destination, or return it
/// unchanged when it is already marked (from wikilink preprocessing) or is a
/// pure same-page anchor / empty link (left to the browser).
fn mark_link_url(
    url: &str,
    source_path: &str,
    _all_paths: &[String],
    exists: &dyn Fn(&str) -> bool,
) -> String {
    if url.starts_with(M_INTERNAL) || url.starts_with(M_BROKEN) || url.starts_with(M_EXTERNAL) {
        return url.to_string(); // already classified via wikilink preprocessing
    }
    if is_external(url) {
        return format!("{M_EXTERNAL}{url}");
    }
    if url.is_empty() || url.starts_with('#') {
        return url.to_string(); // in-page anchor / empty — leave to the browser
    }
    match resolve_internal(source_path, url) {
        Some(path) if exists(&path) => format!("{M_INTERNAL}{path}"),
        Some(path) => format!("{M_BROKEN}{path}"),
        None => url.to_string(),
    }
}

/// Rewrite the marker hrefs comrak emitted into the final anchor attributes.
fn rewrite_marker_hrefs(html: &str) -> String {
    let re = Regex::new(r#"href="(sapint|sapbroken|sapext):([^"]*)""#).unwrap();
    re.replace_all(html, |caps: &regex::Captures| {
        let payload = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        match &caps[1] {
            "sapint" => {
                let path = percent_decode(payload);
                format!(
                    r#"class="internal-link" data-path="{}" href="{}""#,
                    attr_escape(&path),
                    concept_url(&path),
                )
            }
            "sapbroken" => {
                let path = percent_decode(payload);
                format!(
                    r#"class="internal-link broken" data-path="{}" data-broken="true" href="{}""#,
                    attr_escape(&path),
                    concept_url(&path),
                )
            }
            // External: keep comrak's already-encoded href, just drop the marker
            // scheme and open in a new tab.
            _ => format!(
                r#"href="{}" target="_blank" rel="noopener noreferrer""#,
                payload
            ),
        }
    })
    .into_owned()
}

// --- Frontmatter + outline --------------------------------------------------

fn frontmatter_fields(content: &str) -> Vec<FrontmatterField> {
    let Some(block) = frontmatter_block(content) else {
        return Vec::new();
    };
    let value: serde_yaml::Value = match serde_yaml::from_str(block) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(map) = value.as_mapping() else {
        return Vec::new();
    };
    // serde_yaml::Mapping preserves insertion order.
    map.iter()
        .filter_map(|(k, v)| {
            k.as_str().map(|key| FrontmatterField {
                key: key.to_string(),
                values: yaml_values(v),
            })
        })
        .collect()
}

fn yaml_values(v: &serde_yaml::Value) -> Vec<String> {
    match v {
        serde_yaml::Value::Sequence(seq) => seq.iter().map(scalar_string).collect(),
        _ => vec![scalar_string(v)],
    }
}

fn scalar_string(v: &serde_yaml::Value) -> String {
    match v {
        serde_yaml::Value::String(s) => s.clone(),
        serde_yaml::Value::Bool(b) => b.to_string(),
        serde_yaml::Value::Number(n) => n.to_string(),
        serde_yaml::Value::Null => String::new(),
        other => serde_yaml::to_string(other)
            .unwrap_or_default()
            .trim()
            .to_string(),
    }
}

/// De-duplicate heading slugs in document order (`notes`, `notes-1`, …), the
/// same rule as the desktop `slugifyHeadings`.
fn build_outline(headings: Vec<(u8, String)>) -> Vec<OutlineHeading> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    headings
        .into_iter()
        .map(|(level, text)| {
            let base = slugify(&text);
            let n = counts.entry(base.clone()).or_insert(0);
            let slug = if *n == 0 {
                base.clone()
            } else {
                format!("{base}-{n}")
            };
            *n += 1;
            OutlineHeading { level, text, slug }
        })
        .collect()
}

/// Concatenate the visible text of a node's inline descendants (Text + inline
/// Code), trimmed. Used to derive a heading's outline text.
fn node_text<'a>(node: &'a comrak::nodes::AstNode<'a>) -> String {
    let mut s = String::new();
    for d in node.descendants() {
        match &d.data.borrow().value {
            NodeValue::Text(t) => s.push_str(t),
            NodeValue::Code(c) => s.push_str(&c.literal),
            _ => {}
        }
    }
    s.trim().to_string()
}

// --- Small escaping helpers -------------------------------------------------

/// Escape the characters that would break a markdown link TEXT (`[ ... ]`).
fn escape_link_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if matches!(ch, '\\' | '[' | ']') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Escape a string for use inside an HTML double-quoted attribute value.
fn attr_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Percent-encode a value for a query-string parameter (like encodeURIComponent:
/// keep unreserved chars, `%XX` everything else, including `/`).
fn query_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// A Concept's bundle path → its pretty viewer URL pathname, mirroring the
/// frontend `conceptToUrl`: drop a trailing `.md` and a trailing `/index`, map
/// the root `index.md` to `/`, and percent-encode each path segment. So
/// `providers/index.md` → `/providers` and `research/providers/x.md` →
/// `/research/providers/x`.
fn concept_url(path: &str) -> String {
    let p = if path.len() >= 3 && path[path.len() - 3..].eq_ignore_ascii_case(".md") {
        &path[..path.len() - 3]
    } else {
        path
    };
    if p == "index" {
        return "/".to_string();
    }
    let p = p.strip_suffix("/index").unwrap_or(p);
    let encoded: Vec<String> = p.split('/').map(query_encode).collect();
    format!("/{}", encoded.join("/"))
}

/// Decode `%XX` percent-escapes (comrak percent-encodes hrefs, e.g. space →
/// `%20`). Invalid escapes are passed through verbatim.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(ps: &[&str]) -> Vec<String> {
        ps.iter().map(|s| s.to_string()).collect()
    }

    fn render(body: &str, source: &str, all: &[&str]) -> RenderPayload {
        let all = paths(all);
        let set: Vec<String> = all.clone();
        render_body(body, source, &all, &move |p| set.iter().any(|x| x == p))
    }

    #[test]
    fn renders_basic_markdown_elements() {
        let p = render("# Title\n\nA paragraph.\n", "a.md", &["a.md"]);
        assert!(p.html.contains("<h1 id="));
        assert!(p.html.contains("<p>"));
        assert!(p.html.contains("A paragraph."));
    }

    #[test]
    fn concept_url_drops_md_and_index() {
        assert_eq!(concept_url("index.md"), "/");
        assert_eq!(concept_url("good.md"), "/good");
        assert_eq!(concept_url("providers/index.md"), "/providers");
        assert_eq!(
            concept_url("research/providers/mistral-ai.md"),
            "/research/providers/mistral-ai"
        );
        assert_eq!(concept_url("a b/c d.md"), "/a%20b/c%20d");
    }

    #[test]
    fn resolved_markdown_link_becomes_internal_nav() {
        let p = render("[go](/good.md)", "a.md", &["a.md", "good.md"]);
        assert!(p.html.contains(r#"class="internal-link""#));
        assert!(p.html.contains(r#"data-path="good.md""#));
        assert!(p.html.contains(r#"href="/good""#));
        assert!(!p.html.contains("broken"));
    }

    #[test]
    fn relative_markdown_link_resolves_against_source_dir() {
        let p = render("[x](./sib.md)", "dir/cur.md", &["dir/sib.md"]);
        assert!(p.html.contains(r#"data-path="dir/sib.md""#));
        assert!(!p.html.contains("broken"));
    }

    #[test]
    fn resolved_wikilink_becomes_internal_nav() {
        // Bare name resolves by basename against the whole bundle.
        let p = render("see [[good]]", "a.md", &["a.md", "sub/good.md"]);
        assert!(p.html.contains(r#"class="internal-link""#));
        assert!(p.html.contains(r#"data-path="sub/good.md""#));
        // Display text is the wikilink name.
        assert!(p.html.contains(">good<"));
    }

    #[test]
    fn broken_markdown_link_is_marked_but_present() {
        let p = render("[gone](/missing.md)", "a.md", &["a.md"]);
        assert!(p.html.contains(r#"class="internal-link broken""#));
        assert!(p.html.contains(r#"data-broken="true""#));
        assert!(p.html.contains(r#"data-path="missing.md""#));
    }

    #[test]
    fn broken_wikilink_is_marked_but_present() {
        let p = render("see [[nope]]", "a.md", &["a.md"]);
        assert!(p.html.contains(r#"class="internal-link broken""#));
        assert!(p.html.contains(r#"data-path="nope""#));
    }

    #[test]
    fn external_link_untouched_opens_new_tab() {
        let p = render("[e](https://example.com)", "a.md", &["a.md"]);
        assert!(p.html.contains(r#"href="https://example.com""#));
        assert!(p.html.contains(r#"target="_blank""#));
        assert!(!p.html.contains("internal-link"));
    }

    #[test]
    fn outline_lists_headings_in_order_with_slugs() {
        let p = render("# One\n\ntext\n\n## Two\n\n## Two\n", "a.md", &["a.md"]);
        let got: Vec<(u8, &str, &str)> = p
            .outline
            .iter()
            .map(|h| (h.level, h.text.as_str(), h.slug.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![(1, "One", "one"), (2, "Two", "two"), (2, "Two", "two-1")]
        );
    }

    #[test]
    fn headings_carry_id_slugs_matching_the_outline() {
        let p = render("# One\n\n## Two\n\n## Two\n", "a.md", &["a.md"]);
        // Each heading gets an id equal to its (de-duplicated) outline slug, so
        // the Outline can scroll the rendered view to it.
        assert!(p.html.contains(r#"<h1 id="one">"#));
        assert!(p.html.contains(r#"<h2 id="two">"#));
        assert!(p.html.contains(r#"<h2 id="two-1">"#));
        let slugs: Vec<&str> = p.outline.iter().map(|h| h.slug.as_str()).collect();
        assert_eq!(slugs, vec!["one", "two", "two-1"]);
    }

    #[test]
    fn fenced_code_headings_excluded_from_outline() {
        let p = render("# Real\n\n```\n# not a heading\n```\n", "a.md", &["a.md"]);
        assert_eq!(p.outline.len(), 1);
        assert_eq!(p.outline[0].text, "Real");
    }

    #[test]
    fn frontmatter_is_parsed_in_order_and_body_excludes_it() {
        let md = "---\ntype: concept\ntitle: Hello\ntags:\n  - a\n  - b\n---\n# Body\n";
        let p = render(md, "a.md", &["a.md"]);
        let keys: Vec<&str> = p.frontmatter.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(keys, vec!["type", "title", "tags"]);
        let tags = &p.frontmatter.iter().find(|f| f.key == "tags").unwrap().values;
        assert_eq!(tags, &vec!["a".to_string(), "b".to_string()]);
        // The `---` frontmatter fences must not leak into the rendered body.
        assert!(!p.html.contains("type: concept"));
        assert!(p.html.contains("<h1 id="));
    }

    #[test]
    fn wikilink_inside_code_is_not_a_link() {
        let p = render("`[[good]]`", "a.md", &["a.md", "good.md"]);
        assert!(!p.html.contains("internal-link"));
        assert!(p.html.contains("<code>"));
    }

    #[test]
    fn mermaid_fence_emits_language_class_and_is_left_inert() {
        // comrak leaves a ```mermaid fence as an inert code block; the web island
        // hydrates it client-side. Confirm the stable `language-mermaid` marker
        // the island targets, and that the source is preserved verbatim.
        let p = render("```mermaid\ngraph TD;\nA-->B;\n```\n", "a.md", &["a.md"]);
        assert!(p.html.contains(r#"class="language-mermaid""#));
        assert!(p.html.contains("graph TD"));
        // A fenced code block is not a heading → excluded from the outline.
        assert!(p.outline.is_empty());
    }
}
