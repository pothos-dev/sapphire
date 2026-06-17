// Unit tests for OKF markdown link resolution (pure module, no DOM/IPC).
// Run with `bun test src/lib`. Pins current resolveLink/isExternalLink behavior.
import { describe, expect, test } from 'bun:test';
import { isExternalLink, resolveLink } from './links';

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
