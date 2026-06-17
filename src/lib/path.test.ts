import { describe, expect, test } from 'bun:test';
import { basename, dirname, joinPath, splitPath, stripMd } from './path';

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
