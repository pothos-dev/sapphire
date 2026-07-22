import { describe, it, expect } from 'bun:test';
import { singleTileLayout, splitRight, splitDown, type Layout } from './tileLayout';
import { nextTile, landingTile, rememberTile, type ColumnMemory } from './tileNav';

// Build a 2-column layout: col0 = [a], col1 = [b, c].
//   splitRight(a→b) → [a | b]; splitDown(b→c) → [a | b,c].
function twoColStacked(): Layout {
  return splitDown(splitRight(singleTileLayout('a'), 'a', 'b'), 'b', 'c');
}
const colId = (l: Layout, ci: number) => l.columns[ci].id;

describe('nextTile — up/down within a column', () => {
  const l = twoColStacked(); // col1 = [b, c]

  it('moves down to the next tile in the column', () => {
    expect(nextTile(l, 'b', 'down')).toEqual({ kind: 'tile', id: 'c' });
  });

  it('moves up to the previous tile in the column', () => {
    expect(nextTile(l, 'c', 'up')).toEqual({ kind: 'tile', id: 'b' });
  });

  it('exits at the top edge (up from the first tile)', () => {
    expect(nextTile(l, 'b', 'up')).toEqual({ kind: 'exit' });
  });

  it('exits at the bottom edge (down from the last tile)', () => {
    expect(nextTile(l, 'c', 'down')).toEqual({ kind: 'exit' });
    // A single-tile column exits both ways.
    expect(nextTile(l, 'a', 'up')).toEqual({ kind: 'exit' });
    expect(nextTile(l, 'a', 'down')).toEqual({ kind: 'exit' });
  });
});

describe('nextTile — left/right across columns', () => {
  const l = twoColStacked(); // [a | b,c]

  it('moves right into the next column, landing on its top tile by default', () => {
    expect(nextTile(l, 'a', 'right')).toEqual({ kind: 'tile', id: 'b' });
  });

  it('moves left into the previous column', () => {
    expect(nextTile(l, 'b', 'left')).toEqual({ kind: 'tile', id: 'a' });
    expect(nextTile(l, 'c', 'left')).toEqual({ kind: 'tile', id: 'a' });
  });

  it('exits at the left edge (left from the leftmost column)', () => {
    expect(nextTile(l, 'a', 'left')).toEqual({ kind: 'exit' });
  });

  it('exits at the right edge (right from the rightmost column)', () => {
    expect(nextTile(l, 'b', 'right')).toEqual({ kind: 'exit' });
    expect(nextTile(l, 'c', 'right')).toEqual({ kind: 'exit' });
  });

  it('exits when the active id is not in the layout', () => {
    expect(nextTile(l, 'zzz', 'left')).toEqual({ kind: 'exit' });
  });
});

describe('nextTile — sticky per-column landing', () => {
  const l = twoColStacked(); // [a | b,c]

  it('lands on the remembered tile of the destination column', () => {
    // Left column remembers `c` as the last-focused tile there.
    const memory: ColumnMemory = { [colId(l, 1)]: 'c' };
    // From `a`, moving right returns to `c` (NOT the top tile `b`).
    expect(nextTile(l, 'a', 'right', memory)).toEqual({ kind: 'tile', id: 'c' });
  });

  it('falls back to the top tile when the remembered tile is gone', () => {
    const memory: ColumnMemory = { [colId(l, 1)]: 'ghost' };
    expect(nextTile(l, 'a', 'right', memory)).toEqual({ kind: 'tile', id: 'b' });
  });
});

describe('landingTile', () => {
  const l = twoColStacked();
  const col1 = l.columns[1]; // [b, c]

  it('prefers the remembered tile when present', () => {
    expect(landingTile(col1, 'c')).toBe('c');
  });
  it('falls back to the top tile without memory', () => {
    expect(landingTile(col1, null)).toBe('b');
  });
  it('falls back to the top tile when the remembered tile is absent', () => {
    expect(landingTile(col1, 'gone')).toBe('b');
  });
});

describe('rememberTile', () => {
  const l = twoColStacked(); // [a | b,c]

  it('records the tile under its column id', () => {
    const next = rememberTile({}, l, 'c');
    expect(next[colId(l, 1)]).toBe('c');
  });

  it('overwrites the prior tile for that column, leaving others intact', () => {
    const first = rememberTile({}, l, 'a'); // col0 → a
    const second = rememberTile(first, l, 'c'); // col1 → c
    expect(second[colId(l, 0)]).toBe('a');
    expect(second[colId(l, 1)]).toBe('c');
    const third = rememberTile(second, l, 'b'); // col1 → b (overwrite)
    expect(third[colId(l, 1)]).toBe('b');
  });

  it('does not mutate the input record', () => {
    const input: ColumnMemory = {};
    const out = rememberTile(input, l, 'a');
    expect(input).toEqual({});
    expect(out).not.toBe(input);
  });

  it('is a no-op copy for a tile that is not in the layout', () => {
    expect(rememberTile({}, l, 'zzz')).toEqual({});
  });
});
