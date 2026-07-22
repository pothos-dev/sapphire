// Layout persistence (pure; no DOM/runes) for the tiling workspace.
//
// The tiled workspace must survive a relaunch: its columns (order + weights),
// each tile (order + weight + Concept path + per-tile view-mode) and which tile
// is active. This module owns the pure shape math — SERIALIZE the live layout
// tree to a plain `StoredLayout`, DESERIALIZE + defensively validate a stored
// shape back into one, and MIGRATE an old single-Concept session — so the
// `.svelte.ts`/`.svelte` layers stay thin and the logic is unit-testable without
// a Svelte runtime.
//
// Tile ids are ephemeral (a per-launch monotonic counter), so the stored shape
// is ID-FREE: the active tile is a `[columnIndex, tileIndex]` pair and the
// workspace rebuilds fresh Tiles from the stored order on restore.

import type { EditorMode } from '$lib/editor/cm';

// Mirrors `DEFAULT_EDITOR_MODE` in cm.ts. Kept as a literal here (with only a
// TYPE import of `EditorMode`) so this pure, unit-tested module never pulls the
// heavy CodeMirror module graph into the test runtime.
const DEFAULT_MODE: EditorMode = 'hybrid';
const EDITOR_MODES: readonly EditorMode[] = ['edit', 'hybrid', 'view'];

/** One persisted tile: its Concept path (null = empty), view-mode, and weight. */
export interface StoredTile {
  /** bundle-relative Concept path, or null for an empty tile. */
  path: string | null;
  /** the tile's per-tile view-mode. */
  mode: EditorMode;
  /** the tile's share of its column's height (0..1; a column's tiles sum to 1). */
  weight: number;
}

/** One persisted column: its share of the row and its stacked tiles. */
export interface StoredColumn {
  /** the column's share of the row's width (0..1; the row's columns sum to 1). */
  weight: number;
  /** the tiles stacked in this column, top to bottom. */
  tiles: StoredTile[];
}

/**
 * The persisted workspace layout: the row of columns, plus which tile is active
 * as an ID-free `[columnIndex, tileIndex]` pair (Tile ids are ephemeral, so we
 * never persist them — the workspace mints fresh ids on restore).
 */
export interface StoredLayout {
  columns: StoredColumn[];
  active: [number, number];
}

/** The minimal live-layout shape `serializeLayout` reads (subset of `Layout`). */
interface LiveLayout {
  columns: { weight: number; tiles: { id: string; weight: number }[] }[];
}

function isEditorMode(v: unknown): v is EditorMode {
  return typeof v === 'string' && (EDITOR_MODES as readonly string[]).includes(v);
}

/** A usable weight is a finite positive number; anything else falls back to 1. */
function coerceWeight(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * SERIALIZE the live layout tree to a plain `StoredLayout`. `tileData` resolves a
 * Tile id to its Concept path + view-mode (missing → an empty hybrid tile). The
 * active tile is located by id and stored as a `[columnIndex, tileIndex]` pair
 * (falling back to `[0, 0]` when the active id is absent). Pure.
 */
export function serializeLayout(
  layout: LiveLayout,
  activeId: string,
  tileData: (id: string) => { path: string | null; mode: EditorMode } | undefined,
): StoredLayout {
  const columns: StoredColumn[] = layout.columns.map((c) => ({
    weight: c.weight,
    tiles: c.tiles.map((t) => {
      const d = tileData(t.id);
      return {
        path: d?.path ?? null,
        mode: d?.mode ?? DEFAULT_MODE,
        weight: t.weight,
      };
    }),
  }));

  let active: [number, number] = [0, 0];
  for (let ci = 0; ci < layout.columns.length; ci++) {
    const ti = layout.columns[ci].tiles.findIndex((t) => t.id === activeId);
    if (ti !== -1) {
      active = [ci, ti];
      break;
    }
  }
  return { columns, active };
}

/**
 * DESERIALIZE + defensively validate an arbitrary stored value into a
 * `StoredLayout`, or `null` when it is missing/corrupt/empty (the caller then
 * falls back to a single empty tile). Structural corruption — a non-object, no
 * columns, or a column with no tiles — yields `null`; cosmetic corruption within
 * an otherwise-valid tile (a bad weight/mode, or a non-string path) is COERCED
 * (weight→1, mode→hybrid, path→null) rather than rejected, so a slightly damaged
 * file still restores. Never throws.
 */
export function deserializeLayout(raw: unknown): StoredLayout | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.columns) || r.columns.length === 0) return null;

  const columns: StoredColumn[] = [];
  for (const rc of r.columns) {
    if (rc === null || typeof rc !== 'object') return null;
    const c = rc as Record<string, unknown>;
    if (!Array.isArray(c.tiles) || c.tiles.length === 0) return null;

    const tiles: StoredTile[] = [];
    for (const rt of c.tiles) {
      if (rt === null || typeof rt !== 'object') return null;
      const t = rt as Record<string, unknown>;
      tiles.push({
        path: typeof t.path === 'string' ? t.path : null,
        mode: isEditorMode(t.mode) ? t.mode : DEFAULT_MODE,
        weight: coerceWeight(t.weight),
      });
    }
    columns.push({ weight: coerceWeight(c.weight), tiles });
  }

  return { columns, active: normalizeActive(r.active, columns) };
}

/** Clamp a stored active pointer to a valid `[columnIndex, tileIndex]`, else `[0, 0]`. */
function normalizeActive(raw: unknown, columns: StoredColumn[]): [number, number] {
  if (
    Array.isArray(raw) &&
    raw.length === 2 &&
    typeof raw[0] === 'number' &&
    typeof raw[1] === 'number'
  ) {
    const [ci, ti] = raw;
    if (ci >= 0 && ci < columns.length && ti >= 0 && ti < columns[ci].tiles.length) {
      return [ci, ti];
    }
  }
  return [0, 0];
}

/**
 * MIGRATE an old single-Concept session (only `lastOpenConcept` + one
 * `editorMode`, no layout) to a single-tile `StoredLayout` showing that Concept
 * in that mode.
 */
export function migrateLegacy(lastOpenConcept: string | null, mode: EditorMode): StoredLayout {
  return {
    columns: [{ weight: 1, tiles: [{ path: lastOpenConcept, mode, weight: 1 }] }],
    active: [0, 0],
  };
}

/**
 * Resolve the layout to reconstruct at startup: a valid stored layout wins; else
 * an old session with a `lastOpenConcept` migrates to a single tile; else `null`
 * (a fresh/empty workspace — the caller keeps its default single empty tile).
 */
export function resolveStoredLayout(
  storedLayout: unknown,
  lastOpenConcept: string | null,
  editorMode: EditorMode,
): StoredLayout | null {
  const parsed = deserializeLayout(storedLayout);
  if (parsed !== null) return parsed;
  if (lastOpenConcept !== null) return migrateLegacy(lastOpenConcept, editorMode);
  return null;
}
