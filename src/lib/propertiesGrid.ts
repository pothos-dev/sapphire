// Cell-index math for the Properties spreadsheet grid (pure; no DOM/state).
//
// The Properties Section is a 2-column grid — column 0 is the KEY cell, column
// 1 is the VALUE cell — with one row per frontmatter Property (see ADR 0003 and
// the properties-grid-navigation slice). The keyboard cursor (the Focused item)
// is a single CELL identified by `{ row, col }`.
//
// This module owns ONLY the index arithmetic for moving that cursor with the
// arrow keys (within nav mode) and for the Tab-advances-right wrap used in edit
// mode. It is deliberately DOM-free and state-free: the `propertiesNav` store
// (state/propertiesNav.svelte.ts) holds the cursor as a rune and applies these
// pure moves; App.svelte mirrors the cursor into DOM focus.
//
// Movement CLAMPS at the grid edges (no wrap) for the arrow keys, matching the
// spreadsheet idiom. `Tab` (edit-mode commit-and-advance) is the one motion that
// wraps key→value→next row's key, so it has its own helper.

/** A grid cell: a row index and a column (0 = key, 1 = value). */
export interface Cell {
  row: number;
  col: 0 | 1;
}

/** Column constants for readability at call sites. */
export const KEY_COL = 0 as const;
export const VALUE_COL = 1 as const;

/** Clamp a row index into `[0, rowCount)`. Returns 0 for an empty grid. */
function clampRow(row: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.max(0, Math.min(row, rowCount - 1));
}

/**
 * Move the cell cursor one step in `direction` over a grid of `rowCount` rows,
 * CLAMPING at every edge (no wrap). Returns the new cell. With no rows the
 * cursor stays at `{ row: 0, col: KEY_COL }`.
 */
export function moveCell(
  cell: Cell,
  direction: 'up' | 'down' | 'left' | 'right',
  rowCount: number,
): Cell {
  if (rowCount <= 0) return { row: 0, col: KEY_COL };
  switch (direction) {
    case 'up':
      return { row: clampRow(cell.row - 1, rowCount), col: cell.col };
    case 'down':
      return { row: clampRow(cell.row + 1, rowCount), col: cell.col };
    case 'left':
      return { row: cell.row, col: KEY_COL };
    case 'right':
      return { row: cell.row, col: VALUE_COL };
  }
}

/**
 * The cell `Tab` advances to from `cell` in EDIT mode: key→value within a row,
 * then value→next row's key. CLAMPS on the value cell of the last row (no wrap
 * back to the top), so Tab off the final cell stays put. Used to drive the
 * commit-and-move-right behaviour.
 */
export function nextCellTab(cell: Cell, rowCount: number): Cell {
  if (rowCount <= 0) return { row: 0, col: KEY_COL };
  if (cell.col === KEY_COL) return { row: cell.row, col: VALUE_COL };
  // On a value cell: advance to the next row's key, or clamp at the last row.
  if (cell.row >= rowCount - 1) return { row: rowCount - 1, col: VALUE_COL };
  return { row: cell.row + 1, col: KEY_COL };
}

/** Clamp a whole cell into the grid after the row count changes. */
export function clampCell(cell: Cell, rowCount: number): Cell {
  return { row: clampRow(cell.row, rowCount), col: cell.col };
}
