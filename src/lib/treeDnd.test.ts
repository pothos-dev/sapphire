import { describe, expect, test } from 'bun:test';
import { canDrop } from './treeDnd';

describe('canDrop', () => {
  test('the Bundle root is never draggable', () => {
    expect(canDrop('', 'folder')).toBe(false);
    expect(canDrop('', '')).toBe(false);
  });

  test('rejects a no-op drop into the current parent', () => {
    expect(canDrop('a/b.md', 'a')).toBe(false); // already in `a`
    expect(canDrop('top.md', '')).toBe(false); // already at the root
  });

  test('rejects dropping a folder into itself or a descendant', () => {
    expect(canDrop('a', 'a')).toBe(false);
    expect(canDrop('a', 'a/b')).toBe(false);
    expect(canDrop('a/b', 'a/b/c')).toBe(false);
  });

  test('allows a genuine move into a different folder', () => {
    expect(canDrop('a/b.md', 'c')).toBe(true);
    expect(canDrop('a/b.md', '')).toBe(true); // up to the root
    expect(canDrop('a', 'b')).toBe(true); // sibling folder
    // A folder whose name is a prefix of the target but not a path ancestor.
    expect(canDrop('a', 'ab')).toBe(true);
  });
});
