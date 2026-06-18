// YAML frontmatter parsing for the in-memory fake backend's index.
//
// The fake's Bundle index must mirror the Rust `index.rs` `parse_frontmatter`:
// it extracts `type` (a scalar), `tags` (a flat sequence of scalars), and the
// distinct top-level keys from a Concept's leading `---` block. The Rust side
// uses a real YAML parser (`serde_yaml`); to stay behaviourally faithful, the
// fake parses with the same `yaml` package the Properties panel uses, rather
// than ad-hoc regexes. This makes quoted YAML (`tags: ["a","b"]`, quoted keys,
// quoted scalars) parse identically to the real backend.
//
// Tolerates missing/invalid frontmatter: returns empty results rather than
// throwing (broken Concepts are never blocked).

import { parse } from 'yaml';
import { splitFrontmatter } from '$lib/frontmatter';

/** Parse the top-level YAML mapping of a Concept's frontmatter, or null. */
function parseMapping(content: string): Record<string, unknown> | null {
  const { hasFrontmatter, yaml } = splitFrontmatter(content);
  if (!hasFrontmatter) return null;
  let value: unknown;
  try {
    value = parse(yaml);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Parse `type` (scalar) and `tags` (flat list) from frontmatter. */
export function parseFrontmatter(content: string): { type: string | null; tags: string[] } {
  const map = parseMapping(content);
  if (map === null) return { type: null, tags: [] };

  // `type`: a non-empty string scalar; anything else (missing, empty, non-scalar)
  // is treated as absent, matching the Rust `.as_str().filter(|s| !s.is_empty())`.
  let type: string | null = null;
  const rawType = map['type'];
  if (typeof rawType === 'string' && rawType !== '') type = rawType;

  // `tags`: a sequence; keep only its string items (Rust `as_str` filter_map).
  const tags: string[] = [];
  const rawTags = map['tags'];
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      if (typeof t === 'string') tags.push(t);
    }
  }
  return { type, tags };
}

/**
 * Distinct top-level frontmatter keys of a Concept (e.g. `type`, `title`,
 * `nested`). Mirrors the Rust `parse_frontmatter` key collection: the string
 * keys of the top-level mapping. Returns `[]` when there is no valid block.
 */
export function parseFrontmatterKeys(content: string): string[] {
  const map = parseMapping(content);
  if (map === null) return [];
  return Object.keys(map);
}
