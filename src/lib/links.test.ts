// Unit tests for OKF markdown link resolution (pure module, no DOM/IPC).
// Run with `bun test src/lib`. Pins current resolveLink/isExternalLink behavior.
import { describe, expect, test } from 'bun:test';
import { isExternalLink, resolveLink, resolveWikilink, splitWikilinkTarget } from './links';

describe('isExternalLink', () => {
  test('scheme URLs are external', () => {
    expect(isExternalLink('https://example.com')).toBe(true);
    expect(isExternalLink('http://x')).toBe(true);
    expect(isExternalLink('mailto:a@b.c')).toBe(true);
    expect(isExternalLink('tel:123')).toBe(true);
  });
  test('bundle paths are not external', () => {
    expect(isExternalLink('/foo.md')).toBe(false);
    expect(isExternalLink('./foo.md')).toBe(false);
    expect(isExternalLink('foo.md')).toBe(false);
    expect(isExternalLink('#anchor')).toBe(false);
  });
});

describe('resolveLink', () => {
  test('empty / whitespace href resolves to none', () => {
    expect(resolveLink('a.md', '')).toEqual({ kind: 'none' });
    expect(resolveLink('a.md', '   ')).toEqual({ kind: 'none' });
  });

  test('external links pass through trimmed', () => {
    expect(resolveLink('a.md', '  https://x.com  ')).toEqual({
      kind: 'external',
      href: 'https://x.com',
    });
  });

  test('pure anchor is a no-op', () => {
    expect(resolveLink('a.md', '#heading')).toEqual({ kind: 'none' });
  });

  test('bundle-absolute strips the leading slash', () => {
    expect(resolveLink('dir/cur.md', '/foo/bar.md')).toEqual({
      kind: 'internal',
      path: 'foo/bar.md',
    });
  });

  test('relative resolves against the current Concept directory', () => {
    expect(resolveLink('dir/cur.md', './sib.md')).toEqual({
      kind: 'internal',
      path: 'dir/sib.md',
    });
    expect(resolveLink('dir/cur.md', 'bare.md')).toEqual({
      kind: 'internal',
      path: 'dir/bare.md',
    });
    expect(resolveLink('cur.md', 'bare.md')).toEqual({
      kind: 'internal',
      path: 'bare.md',
    });
  });

  test('parent segments are normalized', () => {
    expect(resolveLink('dir/sub/cur.md', '../up.md')).toEqual({
      kind: 'internal',
      path: 'dir/up.md',
    });
    expect(resolveLink('cur.md', '/a/../b.md')).toEqual({
      kind: 'internal',
      path: 'b.md',
    });
  });

  test('escaping parent segments are dropped (no escape above root)', () => {
    expect(resolveLink('cur.md', '/../x.md')).toEqual({
      kind: 'internal',
      path: 'x.md',
    });
  });

  test('trailing #anchor and ?query are stripped from the path', () => {
    expect(resolveLink('cur.md', 'path.md#sec')).toEqual({
      kind: 'internal',
      path: 'path.md',
    });
    expect(resolveLink('cur.md', '/path.md?x=1#sec')).toEqual({
      kind: 'internal',
      path: 'path.md',
    });
  });

  test('absolute href that normalizes to empty is none', () => {
    expect(resolveLink('cur.md', '/')).toEqual({ kind: 'none' });
    expect(resolveLink('cur.md', '/.')).toEqual({ kind: 'none' });
  });
});

describe('splitWikilinkTarget', () => {
  test('bare name has no alias/anchor', () => {
    expect(splitWikilinkTarget('CodeMirror')).toEqual({
      name: 'CodeMirror',
      alias: null,
      anchor: null,
    });
  });
  test('alias after first | (anchor inside alias stays in alias)', () => {
    expect(splitWikilinkTarget('Name|Display#Text')).toEqual({
      name: 'Name',
      alias: 'Display#Text',
      anchor: null,
    });
  });
  test('anchor after first # in the name part', () => {
    expect(splitWikilinkTarget('Name#Heading')).toEqual({
      name: 'Name',
      alias: null,
      anchor: 'Heading',
    });
  });
  test('name#anchor|alias splits all three', () => {
    expect(splitWikilinkTarget('Name#Heading|Display')).toEqual({
      name: 'Name',
      alias: 'Display',
      anchor: 'Heading',
    });
  });
});

describe('resolveWikilink', () => {
  const paths = [
    'index.md',
    'log.md',
    'concepts/codemirror.md',
    'concepts/editor/live-preview.md',
    'concepts/Live Preview.md',
    'archive/codemirror.md',
  ];

  test('bare name matches by basename', () => {
    expect(resolveWikilink(paths, 'index.md', 'live-preview')).toEqual({
      path: 'concepts/editor/live-preview.md',
    });
  });

  test('case-insensitive, literal (no slug normalization)', () => {
    // [[live preview]] matches the literal "Live Preview.md", not live-preview.md.
    expect(resolveWikilink(paths, 'index.md', 'live preview')).toEqual({
      path: 'concepts/Live Preview.md',
    });
    // codemirror.md is duplicated; the tie-break (shortest, then lexicographic)
    // makes the bare/upper-case match land on archive/ — see the dedicated case.
    expect(resolveWikilink(paths, 'index.md', 'CODEMIRROR')).toEqual({
      path: 'archive/codemirror.md',
    });
  });

  test('partial path matches by suffix', () => {
    expect(resolveWikilink(paths, 'index.md', 'editor/live-preview')).toEqual({
      path: 'concepts/editor/live-preview.md',
    });
  });

  test('duplicate basename tie-break: shortest path then lexicographic', () => {
    // codemirror.md exists at concepts/ and archive/ — shorter path wins; tie on
    // depth resolves alphabetically (archive < concepts).
    expect(resolveWikilink(paths, 'index.md', 'codemirror')).toEqual({
      path: 'archive/codemirror.md',
    });
  });

  test('strips .md extension', () => {
    expect(resolveWikilink(paths, 'index.md', 'log.md')).toEqual({ path: 'log.md' });
  });

  test('strips |alias and #anchor before matching', () => {
    expect(resolveWikilink(paths, 'index.md', 'log|Change Log')).toEqual({ path: 'log.md' });
    expect(resolveWikilink(paths, 'index.md', 'log#today')).toEqual({ path: 'log.md' });
    expect(resolveWikilink(paths, 'index.md', 'log#today|Change Log')).toEqual({ path: 'log.md' });
  });

  test('empty target (pure same-file anchor) resolves to the source', () => {
    expect(resolveWikilink(paths, 'concepts/codemirror.md', '#heading')).toEqual({
      path: 'concepts/codemirror.md',
    });
  });

  test('unresolved name returns null', () => {
    expect(resolveWikilink(paths, 'index.md', 'does-not-exist')).toBeNull();
    expect(resolveWikilink(paths, 'index.md', 'wrong/live-preview')).toBeNull();
  });
});
