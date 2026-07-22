// Browser-style navigation history (pure; no DOM/IPC/runes).
//
// The per-Pane list of visited Concept paths plus a cursor into it. Opening a
// Concept pushes onto the stack, truncating any forward entries (standard
// browser semantics); Back/Forward move the cursor without re-pushing. Kept as
// a plain, immutable value type so the Pane rune store stays thin over it and
// the index math is unit-testable without a Svelte runtime.

import { remapPath } from '$lib/path';

/** An immutable navigation-history value: the visited paths and the cursor. */
export interface NavHistory {
  /** Visited Concept paths; `entries[index]` is the current Concept. */
  readonly entries: readonly string[];
  /** Cursor into `entries` (-1 when empty). */
  readonly index: number;
}

/** The empty history (nothing visited yet). */
export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 };

/** True when there is a previous Concept to go Back to. */
export function canGoBack(h: NavHistory): boolean {
  return h.index > 0;
}

/** True when there is a forward Concept to advance to. */
export function canGoForward(h: NavHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/**
 * Push a newly-opened Concept as the current entry, truncating any forward
 * history first (standard browser semantics).
 */
export function pushEntry(h: NavHistory, path: string): NavHistory {
  const entries = [...h.entries.slice(0, h.index + 1), path];
  return { entries, index: entries.length - 1 };
}

/** Move the cursor back one entry, if possible (else unchanged). */
export function goBack(h: NavHistory): NavHistory {
  return canGoBack(h) ? { entries: h.entries, index: h.index - 1 } : h;
}

/** Move the cursor forward one entry, if possible (else unchanged). */
export function goForward(h: NavHistory): NavHistory {
  return canGoForward(h) ? { entries: h.entries, index: h.index + 1 } : h;
}

/**
 * Rewrite any entries that ARE `from` or sit beneath it (folder rename/move)
 * to the new location, so Back/Forward stay valid across a rename. Returns the
 * rewritten history and whether anything changed.
 */
export function remapHistory(
  h: NavHistory,
  from: string,
  to: string,
): { history: NavHistory; changed: boolean } {
  let changed = false;
  const entries = h.entries.map((p) => {
    const next = remapPath(p, from, to);
    if (next !== null) changed = true;
    return next ?? p;
  });
  return { history: { entries, index: h.index }, changed };
}
