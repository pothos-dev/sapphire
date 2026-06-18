// Unit tests for the fake backend's index frontmatter parse.
//
// Run with `bun test src/lib`. These pin the fake's `type`/`tags`/keys parse to
// the Rust `index.rs` `parse_frontmatter` behaviour, which uses a real YAML
// parser. The original fake used regexes that mishandled quoted YAML — the
// "quoted" cases below are the regression guard for that bug.
import { describe, expect, test } from 'bun:test';
import { parseFrontmatter, parseFrontmatterKeys } from './frontmatter';

const fm = (yaml: string) => `---\n${yaml}\n---\n\n# Body\n`;

describe('parseFrontmatter (fake index)', () => {
  test('plain inline tags list', () => {
    const { type, tags } = parseFrontmatter(fm('type: concept\ntags: [okf, demo]'));
    expect(type).toBe('concept');
    expect(tags).toEqual(['okf', 'demo']);
  });

  test('block-list tags', () => {
    const { tags } = parseFrontmatter(fm('type: concept\ntags:\n  - okf\n  - demo'));
    expect(tags).toEqual(['okf', 'demo']);
  });

  test('empty type is treated as absent', () => {
    expect(parseFrontmatter(fm('type:\ntitle: x')).type).toBeNull();
  });

  test('no frontmatter block', () => {
    const { type, tags } = parseFrontmatter('# Just a body\n');
    expect(type).toBeNull();
    expect(tags).toEqual([]);
  });

  // --- Regression: quoted YAML the old regex parse mishandled ---

  test('quoted inline tags strip their quotes (bug fix)', () => {
    // The old regex split on commas and kept the surrounding quotes, yielding
    // `"a"` / `"b"` instead of `a` / `b`. A real YAML parser unquotes them.
    const { tags } = parseFrontmatter(fm('type: concept\ntags: ["a", "b"]'));
    expect(tags).toEqual(['a', 'b']);
  });

  test('quoted scalar type is unquoted (bug fix)', () => {
    expect(parseFrontmatter(fm('type: "concept"')).type).toBe('concept');
  });

  test('inline tag value containing a comma is one tag, not split', () => {
    const { tags } = parseFrontmatter(fm('type: concept\ntags: ["a, b", c]'));
    expect(tags).toEqual(['a, b', 'c']);
  });
});

describe('parseFrontmatterKeys (fake index)', () => {
  test('distinct top-level keys, not nested or list items', () => {
    const keys = parseFrontmatterKeys(
      fm('type: concept\ntitle: T\nnested:\n  author: jane\ntags:\n  - a'),
    );
    expect(keys.sort()).toEqual(['nested', 'tags', 'title', 'type']);
  });

  test('quoted key is unquoted (bug fix)', () => {
    // The old regex captured the literal `"custom field"` including quotes.
    const keys = parseFrontmatterKeys(fm('type: concept\n"custom field": v'));
    expect(keys).toContain('custom field');
  });

  test('no block yields no keys', () => {
    expect(parseFrontmatterKeys('# Body only\n')).toEqual([]);
  });
});
