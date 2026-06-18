// Flattened-visible-row math for Explorer keyboard navigation (pure; no DOM/state).
//
// The Explorer renders the Bundle tree as nested rows; arrowing the keyboard
// Focused item moves over the VISIBLE rows only — children of a collapsed folder
// are skipped, and reserved files (index.md / log.md) are never ordinary rows
// (they surface as folder-header affordances). This module flattens the tree
// into that exact visible order and owns the index math.
//
// Unlike `listNav.ts` (which WRAPS for the modal palettes) movement here CLAMPS
// at the ends: a tree is spatial, so arrowing past the last row stays put rather
// than jumping to the first. Tags reuses this in a later slice, so it lives in
// its own pure module with unit tests.

import type { TreeNode } from '$lib/types';
import { isReservedFile } from '$lib/reserved';

/** One row in the flattened visible-rows list. */
export interface VisibleRow {
  /** bundle-relative path of the node this row renders. */
  path: string;
  /** True for a folder row, false for a Concept (`.md`) row. */
  isDir: boolean;
  /** Indentation depth (root's ordinary children are depth 0). */
  depth: number;
  /** bundle-relative path of the containing folder ('' = Bundle root). */
  parentPath: string;
  /** For a folder row: whether it is currently expanded. (false for files) */
  expanded: boolean;
}

/**
 * The ordinary children of `node` in render order: folders and Concepts (`.md`),
 * excluding reserved files and any non-markdown file. Mirrors the filter applied
 * by `Tree.svelte` / the App root listing, so the flattened order matches the
 * DOM exactly.
 */
function ordinaryChildren(node: TreeNode): TreeNode[] {
  return (node.children ?? []).filter(
    (c) => c.isDir || (c.name.toLowerCase().endsWith('.md') && !isReservedFile(c.path)),
  );
}

/**
 * Flatten the Bundle tree into the ordered list of VISIBLE rows: a depth-first
 * walk over the ordinary children of `root`, descending into a folder only when
 * `isExpanded(folderPath)` is true. `root` is the Bundle-root node (`path: ''`)
 * and is NOT itself a row — only its descendants are.
 */
export function flattenVisible(
  root: TreeNode | null,
  isExpanded: (path: string) => boolean,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  if (root === null) return rows;

  const walk = (node: TreeNode, depth: number, parentPath: string): void => {
    for (const child of ordinaryChildren(node)) {
      const expanded = child.isDir && isExpanded(child.path);
      rows.push({
        path: child.path,
        isDir: child.isDir,
        depth,
        parentPath,
        expanded,
      });
      if (child.isDir && expanded) walk(child, depth + 1, child.path);
    }
  };

  walk(root, 0, '');
  return rows;
}

/** The row index of `path` in `rows`, or -1 when absent. */
export function indexOfPath(rows: VisibleRow[], path: string | null): number {
  if (path === null) return -1;
  return rows.findIndex((r) => r.path === path);
}

/**
 * Next index moving DOWN, CLAMPED at the last row (no wrap). Returns 0 for an
 * empty list. A `from` of -1 (nothing focused) lands on the first row.
 */
export function nextIndexClamped(from: number, length: number): number {
  if (length === 0) return 0;
  if (from < 0) return 0;
  return Math.min(from + 1, length - 1);
}

/**
 * Previous index moving UP, CLAMPED at the first row (no wrap). Returns 0 for an
 * empty list. A `from` of -1 (nothing focused) lands on the first row.
 */
export function prevIndexClamped(from: number, length: number): number {
  if (length === 0) return 0;
  if (from < 0) return 0;
  return Math.max(from - 1, 0);
}
