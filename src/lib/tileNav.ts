// Editor-internal grid navigation math (pure; no DOM/runes) for the tiling area.
//
// The editor area is ONE logical `'editor'` Region (see `regionGrid`) that
// internally owns a 2D tile grid: a ROW OF COLUMNS, each a vertical STACK of
// tiles (see `tileLayout`). This module owns the pure movement math that sits IN
// FRONT of the Region backbone:
//
//   - Alt+Left / Alt+Right move between COLUMNS,
//   - Alt+Up / Alt+Down move between TILES within the current column.
//
// When a move would leave the grid's edge in that direction, the result is an
// `{ kind: 'exit' }` signal: the caller (App.svelte) then DELEGATES to the
// Region backbone (`focus.moveFocus(dir)`) so movement crosses into the sidebars
// exactly as the single editor does today (leftmost column → Explorer/Tags;
// rightmost → Outline/Backlinks; top/bottom tile → the vertical Region step).
//
// Sticky per-column landing: moving left/right into a column returns to the tile
// you were last on there. The caller keeps the per-column memory (a plain
// `{ [columnId]: tileId }` record, updated via `rememberTile`) and hands it to
// `nextTile`; this module reads it (`landingTile`) but never mutates it.

import type { Column, Layout } from '$lib/tileLayout';
import { columnIndexOf } from '$lib/tileLayout';
import type { Direction } from '$lib/regionGrid';

/** Per-column sticky memory: the tile last focused in each column, by column id. */
export type ColumnMemory = Readonly<Record<string, string>>;

/**
 * Result of an intra-grid move:
 *  - `{ kind: 'tile', id }` — focus this tile (a move landed inside the grid);
 *  - `{ kind: 'exit' }` — the move left the grid's edge; the caller delegates to
 *    the Region backbone (`focus.moveFocus`) for cross-Region movement.
 */
export type TileMove = { kind: 'tile'; id: string } | { kind: 'exit' };

/**
 * Which tile to land on when ENTERING `col`: its sticky `memory` tile when that
 * tile still lives in the column, else the column's TOP tile. Pure — the source
 * of the per-column stickiness on left/right movement.
 */
export function landingTile(col: Column, memory: string | null): string {
  if (memory !== null && col.tiles.some((t) => t.id === memory)) return memory;
  return col.tiles[0].id;
}

/**
 * Compute the tile to move to from the active tile `activeId` in `direction`,
 * given the layout tree and the per-column landing `memory`.
 *
 * Rules:
 *  - up/down move WITHIN the active column to the adjacent tile; at the top/
 *    bottom edge the move EXITS the grid (delegated to the vertical Region step).
 *  - left/right change COLUMN, landing on the destination column's sticky tile
 *    (`landingTile`); at the leftmost/rightmost column the move EXITS the grid
 *    (delegated to cross into the sidebars).
 *
 * Returns `{ kind: 'exit' }` when `activeId` is not in the layout, so a dangling
 * active id degrades to Region movement rather than crashing.
 */
export function nextTile(
  layout: Layout,
  activeId: string,
  direction: Direction,
  memory: ColumnMemory = {},
): TileMove {
  const ci = columnIndexOf(layout, activeId);
  if (ci === -1) return { kind: 'exit' };
  const col = layout.columns[ci];

  if (direction === 'up' || direction === 'down') {
    const ti = col.tiles.findIndex((t) => t.id === activeId);
    const ni = ti + (direction === 'down' ? 1 : -1);
    if (ni < 0 || ni >= col.tiles.length) return { kind: 'exit' };
    return { kind: 'tile', id: col.tiles[ni].id };
  }

  // left / right: change column.
  const nc = ci + (direction === 'right' ? 1 : -1);
  if (nc < 0 || nc >= layout.columns.length) return { kind: 'exit' };
  const dest = layout.columns[nc];
  return { kind: 'tile', id: landingTile(dest, memory[dest.id] ?? null) };
}

/**
 * Record `tileId` as the sticky tile of the column that holds it. Returns a NEW
 * memory record (pure); a no-op copy when the tile is not in the layout. The
 * caller replaces its stored memory with the result whenever a tile takes focus.
 */
export function rememberTile(memory: ColumnMemory, layout: Layout, tileId: string): Record<string, string> {
  const col = layout.columns.find((c) => c.tiles.some((t) => t.id === tileId));
  if (!col) return { ...memory };
  return { ...memory, [col.id]: tileId };
}
