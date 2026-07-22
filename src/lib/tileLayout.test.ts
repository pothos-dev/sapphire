import { describe, it, expect } from 'bun:test';
import {
  singleTileLayout,
  allTileIds,
  columnIndexOf,
  splitRight,
  splitDown,
  closeTile,
  neighborAfterClose,
  resizeWeights,
  resizeColumns,
  resizeTiles,
  MIN_WEIGHT,
  type Layout,
} from './tileLayout';

/** Sum of column weights (should always be ~1). */
const colSum = (l: Layout) => l.columns.reduce((a, c) => a + c.weight, 0);
/** Sum of tile weights in a column (should always be ~1). */
const tileSum = (l: Layout, ci: number) => l.columns[ci].tiles.reduce((a, t) => a + t.weight, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('singleTileLayout', () => {
  it('is one full-weight column with one full-weight tile', () => {
    const l = singleTileLayout('a');
    expect(l.columns).toHaveLength(1);
    expect(l.columns[0].weight).toBe(1);
    expect(l.columns[0].tiles).toEqual([{ id: 'a', weight: 1 }]);
    expect(allTileIds(l)).toEqual(['a']);
  });
});

describe('splitRight', () => {
  it('adds a new column right of the active column, weights sum to 1', () => {
    const l = splitRight(singleTileLayout('a'), 'a', 'b');
    expect(l.columns).toHaveLength(2);
    expect(allTileIds(l)).toEqual(['a', 'b']);
    expect(near(colSum(l), 1)).toBe(true);
    // Two columns from one → equal halves.
    expect(near(l.columns[0].weight, 0.5)).toBe(true);
    expect(near(l.columns[1].weight, 0.5)).toBe(true);
  });

  it('inserts immediately after the active column (not at the end)', () => {
    let l = splitRight(singleTileLayout('a'), 'a', 'b'); // [a,b]
    l = splitRight(l, 'a', 'c'); // split a again → [a,c,b]
    expect(allTileIds(l)).toEqual(['a', 'c', 'b']);
    expect(near(colSum(l), 1)).toBe(true);
    // Three equal columns.
    for (const c of l.columns) expect(near(c.weight, 1 / 3)).toBe(true);
  });

  it('is a no-op for an unknown active id', () => {
    const l = singleTileLayout('a');
    expect(splitRight(l, 'zzz', 'b')).toBe(l);
  });
});

describe('splitDown', () => {
  it('adds a tile below the active one in the same column', () => {
    const l = splitDown(singleTileLayout('a'), 'a', 'b');
    expect(l.columns).toHaveLength(1);
    expect(l.columns[0].tiles.map((t) => t.id)).toEqual(['a', 'b']);
    expect(near(tileSum(l, 0), 1)).toBe(true);
    expect(near(l.columns[0].tiles[0].weight, 0.5)).toBe(true);
  });

  it('only affects the active column', () => {
    let l = splitRight(singleTileLayout('a'), 'a', 'b'); // [a | b]
    l = splitDown(l, 'a', 'c'); // column 0 → [a,c]
    expect(l.columns[0].tiles.map((t) => t.id)).toEqual(['a', 'c']);
    expect(l.columns[1].tiles.map((t) => t.id)).toEqual(['b']);
    expect(near(tileSum(l, 0), 1)).toBe(true);
    expect(near(colSum(l), 1)).toBe(true);
  });
});

describe('neighborAfterClose / closeTile', () => {
  it('closing a stacked tile focuses the next tile in the column', () => {
    let l = splitDown(singleTileLayout('a'), 'a', 'b'); // column [a,b]
    expect(neighborAfterClose(l, 'a')).toBe('b');
    const { layout, focusId } = closeTile(l, 'a');
    expect(focusId).toBe('b');
    expect(allTileIds(layout)).toEqual(['b']);
    expect(near(layout.columns[0].tiles[0].weight, 1)).toBe(true);
  });

  it('closing the last tile in a column focuses the adjacent column', () => {
    const l = splitRight(singleTileLayout('a'), 'a', 'b'); // [a | b]
    expect(neighborAfterClose(l, 'b')).toBe('a');
    const { layout, focusId } = closeTile(l, 'b');
    expect(focusId).toBe('a');
    expect(layout.columns).toHaveLength(1);
    expect(near(colSum(layout), 1)).toBe(true);
  });

  it('closing the very last tile yields an empty layout and null focus', () => {
    const { layout, focusId } = closeTile(singleTileLayout('a'), 'a');
    expect(layout.columns).toHaveLength(0);
    expect(focusId).toBeNull();
  });

  it('redistributes a removed tile weight across survivors', () => {
    let l = splitDown(singleTileLayout('a'), 'a', 'b'); // [a:.5, b:.5]
    l = splitDown(l, 'b', 'c'); // column [a, b, c]
    const { layout } = closeTile(l, 'b');
    expect(layout.columns[0].tiles.map((t) => t.id)).toEqual(['a', 'c']);
    expect(near(tileSum(layout, 0), 1)).toBe(true);
  });
});

describe('resizeWeights', () => {
  it('moves weight across a boundary, preserving the sum', () => {
    const out = resizeWeights([0.5, 0.5], 0, 0.2);
    expect(near(out[0], 0.7)).toBe(true);
    expect(near(out[1], 0.3)).toBe(true);
    expect(near(out[0] + out[1], 1)).toBe(true);
  });

  it('clamps so neither sibling drops below the minimum', () => {
    const out = resizeWeights([0.5, 0.5], 0, 0.9, MIN_WEIGHT);
    expect(near(out[1], MIN_WEIGHT)).toBe(true);
    expect(near(out[0], 1 - MIN_WEIGHT)).toBe(true);
  });

  it('clamps a negative drag too', () => {
    const out = resizeWeights([0.5, 0.5], 0, -0.9, MIN_WEIGHT);
    expect(near(out[0], MIN_WEIGHT)).toBe(true);
    expect(near(out[1], 1 - MIN_WEIGHT)).toBe(true);
  });

  it('only touches the two adjacent weights', () => {
    const out = resizeWeights([0.25, 0.25, 0.5], 1, 0.1);
    expect(near(out[0], 0.25)).toBe(true);
    expect(near(out[1], 0.35)).toBe(true);
    expect(near(out[2], 0.4)).toBe(true);
  });

  it('is a no-op copy for an out-of-range boundary', () => {
    expect(resizeWeights([0.5, 0.5], 5, 0.1)).toEqual([0.5, 0.5]);
  });
});

describe('resizeColumns / resizeTiles', () => {
  it('resizeColumns adjusts the boundary between two columns', () => {
    const l = splitRight(singleTileLayout('a'), 'a', 'b');
    const out = resizeColumns(l, 0, 0.2);
    expect(near(out.columns[0].weight, 0.7)).toBe(true);
    expect(near(out.columns[1].weight, 0.3)).toBe(true);
  });

  it('resizeTiles adjusts a boundary within a column', () => {
    const l = splitDown(singleTileLayout('a'), 'a', 'b');
    const out = resizeTiles(l, 0, 0, 0.15);
    expect(near(out.columns[0].tiles[0].weight, 0.65)).toBe(true);
    expect(near(out.columns[0].tiles[1].weight, 0.35)).toBe(true);
  });

  it('resizeTiles is a no-op for an unknown column', () => {
    const l = singleTileLayout('a');
    expect(resizeTiles(l, 9, 0, 0.1)).toBe(l);
  });
});

describe('columnIndexOf', () => {
  it('finds the column holding an id, -1 when absent', () => {
    const l = splitRight(singleTileLayout('a'), 'a', 'b');
    expect(columnIndexOf(l, 'a')).toBe(0);
    expect(columnIndexOf(l, 'b')).toBe(1);
    expect(columnIndexOf(l, 'zzz')).toBe(-1);
  });
});
