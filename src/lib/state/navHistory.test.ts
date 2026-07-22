import { describe, expect, test } from 'bun:test';
import {
  EMPTY_HISTORY,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  pushEntry,
  remapHistory,
  type NavHistory,
} from './navHistory';

const h = (entries: string[], index: number): NavHistory => ({ entries, index });

describe('navHistory', () => {
  test('empty history has no moves', () => {
    expect(canGoBack(EMPTY_HISTORY)).toBe(false);
    expect(canGoForward(EMPTY_HISTORY)).toBe(false);
  });

  test('pushEntry appends and points the cursor at the new entry', () => {
    const a = pushEntry(EMPTY_HISTORY, 'a.md');
    expect(a).toEqual(h(['a.md'], 0));
    const b = pushEntry(a, 'b.md');
    expect(b).toEqual(h(['a.md', 'b.md'], 1));
  });

  test('pushEntry truncates forward history (browser semantics)', () => {
    const forked = pushEntry(goBack(h(['a.md', 'b.md', 'c.md'], 2)), 'd.md');
    // From c(2) go back to b(1), then open d: c is dropped.
    expect(forked).toEqual(h(['a.md', 'b.md', 'd.md'], 2));
  });

  test('canGoBack / canGoForward reflect the cursor position', () => {
    const mid = h(['a.md', 'b.md', 'c.md'], 1);
    expect(canGoBack(mid)).toBe(true);
    expect(canGoForward(mid)).toBe(true);
    expect(canGoBack(h(['a.md', 'b.md'], 0))).toBe(false);
    expect(canGoForward(h(['a.md', 'b.md'], 1))).toBe(false);
  });

  test('goBack / goForward move the cursor and clamp at the ends', () => {
    const start = h(['a.md', 'b.md'], 1);
    expect(goBack(start)).toEqual(h(['a.md', 'b.md'], 0));
    // Already at the front: unchanged.
    expect(goBack(h(['a.md', 'b.md'], 0))).toEqual(h(['a.md', 'b.md'], 0));
    expect(goForward(h(['a.md', 'b.md'], 0))).toEqual(h(['a.md', 'b.md'], 1));
    // Already at the end: unchanged.
    expect(goForward(start)).toEqual(start);
  });

  test('remapHistory rewrites renamed entries and reports the change', () => {
    const before = h(['a.md', 'dir/b.md', 'dir/c.md'], 2);
    const { history, changed } = remapHistory(before, 'dir', 'moved');
    expect(changed).toBe(true);
    expect(history).toEqual(h(['a.md', 'moved/b.md', 'moved/c.md'], 2));
  });

  test('remapHistory is a no-op when nothing matches', () => {
    const before = h(['a.md', 'b.md'], 1);
    const { history, changed } = remapHistory(before, 'x.md', 'y.md');
    expect(changed).toBe(false);
    expect(history).toEqual(before);
  });
});
