// Tiling layout geometry (pure; no DOM/runes) for the editor area.
//
// The editor area is a ROW OF COLUMNS; each column is a vertical STACK of tiles
// (Panes). Rows need not align across columns. This module owns the pure size
// math — weights, split/close redistribution and divider-drag clamping — so the
// `.svelte` layer stays a thin renderer over it and the arithmetic is
// unit-testable without a Svelte runtime.
//
// Sizes are stored as WEIGHTS (fractions) that sum to 1.0 at each level (the
// columns of the row; the tiles of a column). The renderer turns a weight into a
// CSS `flex-grow`, so the exact scale is irrelevant to layout — but we keep them
// normalised so the numbers stay legible and the clamp math is simple.

/** A single tile (Pane slot) in a column, identified by its Pane id. */
export interface Tile {
  /** The Pane id this tile renders (stable across resizes/splits). */
  id: string;
  /** This tile's share of its column's height (0..1; column tiles sum to 1). */
  weight: number;
}

/** A column: a vertical stack of tiles plus the column's share of the row. */
export interface Column {
  /**
   * Stable identity of the column, derived from its founding tile id. Used by the
   * renderer as an `{#each}` key so a column keeps its DOM (and its tiles' live
   * CodeMirror views) across splits/closes/resizes within the row.
   */
  id: string;
  /** This column's share of the row's width (0..1; row columns sum to 1). */
  weight: number;
  /** The tiles stacked in this column, top to bottom. */
  tiles: Tile[];
}

/** The stable column id derived from its founding tile id. */
export function columnId(foundingTileId: string): string {
  return `col:${foundingTileId}`;
}

/** The full editor-area layout: a row of columns. */
export interface Layout {
  columns: Column[];
}

/**
 * The smallest share a column or tile may shrink to under a divider drag, as a
 * fraction of its container. Keeps every tile visibly usable (roughly a tenth of
 * the axis). The `.svelte` drag handler passes this to the resize helpers.
 */
export const MIN_WEIGHT = 0.1;

/** A layout of exactly one column holding one tile for `id` (the fresh app). */
export function singlePaneLayout(id: string): Layout {
  return { columns: [{ id: columnId(id), weight: 1, tiles: [{ id, weight: 1 }] }] };
}

/** Every Pane id present in the layout, in row-major (column, then tile) order. */
export function allTileIds(layout: Layout): string[] {
  return layout.columns.flatMap((c) => c.tiles.map((t) => t.id));
}

/** The index of the column containing `id`, or -1 when absent. */
export function columnIndexOf(layout: Layout, id: string): number {
  return layout.columns.findIndex((c) => c.tiles.some((t) => t.id === id));
}

/**
 * Give a newcomer an equal 1/(n+1) share among `n` existing siblings, scaling the
 * existing ones down proportionally (so their RELATIVE sizes are preserved). The
 * returned list has `n + 1` weights summing to 1, the newcomer last.
 */
function shareWithNewcomer(existing: number[]): number[] {
  const n = existing.length;
  const newWeight = 1 / (n + 1);
  const scale = n / (n + 1);
  return [...existing.map((w) => w * scale), newWeight];
}

/**
 * Redistribute the weight of a removed sibling across the survivors, preserving
 * their relative sizes (scale up so they sum back to 1). Returns `[]` unchanged
 * when there are no survivors.
 */
function redistributeAfterRemoval(remaining: number[]): number[] {
  const sum = remaining.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    // Degenerate (all-zero) — fall back to equal shares.
    return remaining.map(() => 1 / remaining.length);
  }
  return remaining.map((w) => w / sum);
}

/**
 * Split Right: open `newId` in a NEW COLUMN immediately to the right of the
 * column that currently holds `activeId`. The new column is a single-tile stack;
 * all columns are re-weighted so the newcomer takes an equal share. No-op copy
 * when `activeId` is absent.
 */
export function splitRight(layout: Layout, activeId: string, newId: string): Layout {
  const ci = columnIndexOf(layout, activeId);
  if (ci === -1) return layout;
  const weights = shareWithNewcomer(layout.columns.map((c) => c.weight));
  const columns: Column[] = layout.columns.map((c, i) => ({ ...c, weight: weights[i] }));
  const newColumn: Column = {
    id: columnId(newId),
    weight: weights[weights.length - 1],
    tiles: [{ id: newId, weight: 1 }],
  };
  columns.splice(ci + 1, 0, newColumn);
  return { columns };
}

/**
 * Split Down: open `newId` in a NEW TILE immediately below `activeId` in the
 * SAME column. The column's tiles are re-weighted so the newcomer takes an equal
 * share of that column. No-op copy when `activeId` is absent.
 */
export function splitDown(layout: Layout, activeId: string, newId: string): Layout {
  const ci = columnIndexOf(layout, activeId);
  if (ci === -1) return layout;
  const col = layout.columns[ci];
  const ti = col.tiles.findIndex((t) => t.id === activeId);
  const weights = shareWithNewcomer(col.tiles.map((t) => t.weight));
  const tiles: Tile[] = col.tiles.map((t, i) => ({ ...t, weight: weights[i] }));
  const newTile: Tile = { id: newId, weight: weights[weights.length - 1] };
  tiles.splice(ti + 1, 0, newTile);
  const columns = layout.columns.map((c, i) => (i === ci ? { ...c, tiles } : c));
  return { columns };
}

/**
 * The Pane id a close of `id` should focus next: the NEXT tile in the same
 * column, else the PREVIOUS tile there; if `id` is the column's only tile, the
 * first tile of the ADJACENT column (the next column, else the previous). Null
 * when `id` was the last tile in the whole layout. Pure lookahead — does not
 * mutate.
 */
export function neighborAfterClose(layout: Layout, id: string): string | null {
  const ci = columnIndexOf(layout, id);
  if (ci === -1) return null;
  const col = layout.columns[ci];
  const ti = col.tiles.findIndex((t) => t.id === id);
  if (col.tiles.length > 1) {
    const sibling = col.tiles[ti + 1] ?? col.tiles[ti - 1];
    return sibling.id;
  }
  // The column will be removed with this tile: look to an adjacent column.
  const nextCol = layout.columns[ci + 1] ?? layout.columns[ci - 1];
  return nextCol ? nextCol.tiles[0].id : null;
}

/**
 * Close the tile `id`: remove it, redistribute its weight among the survivors of
 * its level, and drop its column if it becomes empty. Returns the new layout and
 * the `focusId` a neighbour should receive (see `neighborAfterClose`), which is
 * null when nothing remains.
 */
export function closeTile(layout: Layout, id: string): { layout: Layout; focusId: string | null } {
  const ci = columnIndexOf(layout, id);
  if (ci === -1) return { layout, focusId: null };
  const focusId = neighborAfterClose(layout, id);
  const col = layout.columns[ci];

  if (col.tiles.length > 1) {
    // Remove the tile; re-weight the column's remaining tiles.
    const remaining = col.tiles.filter((t) => t.id !== id);
    const weights = redistributeAfterRemoval(remaining.map((t) => t.weight));
    const tiles = remaining.map((t, i) => ({ ...t, weight: weights[i] }));
    const columns = layout.columns.map((c, i) => (i === ci ? { ...c, tiles } : c));
    return { layout: { columns }, focusId };
  }

  // Last tile in its column: drop the whole column and re-weight the row.
  const remaining = layout.columns.filter((_, i) => i !== ci);
  if (remaining.length === 0) return { layout: { columns: [] }, focusId };
  const weights = redistributeAfterRemoval(remaining.map((c) => c.weight));
  const columns = remaining.map((c, i) => ({ ...c, weight: weights[i] }));
  return { layout: { columns }, focusId };
}

/**
 * Move `delta` (a signed fraction of the container) across the boundary between
 * siblings `index` and `index + 1`: `weights[index]` grows by `delta` and
 * `weights[index + 1]` shrinks by it. Both are clamped to `min`, so a drag past a
 * neighbour's minimum stops rather than collapsing it. Returns a new array with
 * the same sum. Pure — shared by column and tile dividers.
 */
export function resizeWeights(
  weights: readonly number[],
  index: number,
  delta: number,
  min: number = MIN_WEIGHT,
): number[] {
  if (index < 0 || index + 1 >= weights.length) return [...weights];
  const a = weights[index];
  const b = weights[index + 1];
  const pair = a + b;
  // The pair's total is fixed; the boundary may travel within [min, pair - min].
  const clampedMin = Math.min(min, pair / 2); // never demand more than half each
  let nextA = a + delta;
  nextA = Math.max(clampedMin, Math.min(pair - clampedMin, nextA));
  const nextB = pair - nextA;
  const out = [...weights];
  out[index] = nextA;
  out[index + 1] = nextB;
  return out;
}

/** Resize the boundary between columns `index` and `index + 1` by `delta`. */
export function resizeColumns(layout: Layout, index: number, delta: number, min: number = MIN_WEIGHT): Layout {
  const weights = resizeWeights(layout.columns.map((c) => c.weight), index, delta, min);
  return { columns: layout.columns.map((c, i) => ({ ...c, weight: weights[i] })) };
}

/**
 * Resize the boundary between tiles `index` and `index + 1` within column
 * `columnIndex` by `delta`. No-op copy for an out-of-range column.
 */
export function resizeTiles(
  layout: Layout,
  columnIndex: number,
  index: number,
  delta: number,
  min: number = MIN_WEIGHT,
): Layout {
  const col = layout.columns[columnIndex];
  if (!col) return layout;
  const weights = resizeWeights(col.tiles.map((t) => t.weight), index, delta, min);
  const tiles = col.tiles.map((t, i) => ({ ...t, weight: weights[i] }));
  return { columns: layout.columns.map((c, i) => (i === columnIndex ? { ...c, tiles } : c)) };
}
