import { describe, expect, test } from 'bun:test';
import {
  basename,
  dirname,
  ensureMd,
  isMarkdownName,
  joinPath,
  moveDestination,
  remapPath,
  splitPath,
  stripMd,
} from './path';

describe('basename / dirname', () => {
  test('split a nested path', () => {
    expect(basename('a/b/c.md')).toBe('c.md');
    expect(dirname('a/b/c.md')).toBe('a/b');
  });
  test('root-level path', () => {
    expect(basename('x.md')).toBe('x.md');
    expect(dirname('x.md')).toBe('');
  });
});

describe('stripMd', () => {
  test('removes a trailing .md case-insensitively', () => {
    expect(stripMd('a/b.md')).toBe('a/b');
    expect(stripMd('A.MD')).toBe('A');
    expect(stripMd('no-ext')).toBe('no-ext');
  });
});

describe('isMarkdownName / ensureMd', () => {
  test('isMarkdownName detects a .md extension case-insensitively', () => {
    expect(isMarkdownName('note.md')).toBe(true);
    expect(isMarkdownName('note.MD')).toBe(true);
    expect(isMarkdownName('note')).toBe(false);
    expect(isMarkdownName('note.txt')).toBe(false);
  });
  test('ensureMd appends .md only when absent', () => {
    expect(ensureMd('note')).toBe('note.md');
    expect(ensureMd('note.md')).toBe('note.md');
    expect(ensureMd('note.MD')).toBe('note.MD'); // already markdown — left as-is
  });
});

describe('joinPath', () => {
  test('root folder yields the bare name', () => {
    expect(joinPath('', 'x.md')).toBe('x.md');
    expect(joinPath('a/b', 'c.md')).toBe('a/b/c.md');
  });
});

describe('splitPath', () => {
  test('dir includes the trailing slash', () => {
    expect(splitPath('a/b.md')).toEqual({ dir: 'a/', base: 'b.md' });
    expect(splitPath('x.md')).toEqual({ dir: '', base: 'x.md' });
  });
});

describe('remapPath', () => {
  test('exact match remaps to the new path', () => {
    expect(remapPath('a/b.md', 'a/b.md', 'a/c.md')).toBe('a/c.md');
  });
  test('descendant of a renamed folder is rewritten', () => {
    expect(remapPath('foo/x.md', 'foo', 'bar')).toBe('bar/x.md');
    expect(remapPath('foo/sub/x.md', 'foo', 'bar')).toBe('bar/sub/x.md');
  });
  test('sibling sharing a prefix is NOT matched', () => {
    expect(remapPath('foobar/x.md', 'foo', 'bar')).toBeNull();
    expect(remapPath('other.md', 'foo', 'bar')).toBeNull();
  });
});

describe('moveDestination', () => {
  test('keeps the basename, joining under the target folder', () => {
    expect(moveDestination('a/b.md', 'c')).toBe('c/b.md');
    expect(moveDestination('a/b.md', '')).toBe('b.md');
  });
  test('tolerates trailing slashes on the source and target', () => {
    expect(moveDestination('a/b/', 'c/')).toBe('c/b');
    expect(moveDestination('x.md', 'c//')).toBe('c/x.md');
  });
});
