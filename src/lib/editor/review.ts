// Pure logic for the "Review changes" toggle (working-tree ↔ HEAD).
//
// The toggle turns the open Concept into a read-only review view that renders —
// in memory only — a CriticMarkup diff of `HEAD` against the current working
// tree (see App.svelte for the wiring, and `diff/diffToCriticMarkup.ts` for the
// differ). This module holds the DOM-free, IPC-free decision of WHETHER the
// toggle is available for a given `FileHistory`, plus the explanatory tooltip —
// so it can be unit-tested over plain values (project convention: pure `.ts`,
// thin wiring elsewhere).

import type { FileHistory } from '$lib/types';

/**
 * Whether the review toggle is enabled for the open Concept, and the tooltip to
 * show. Derived from the git `FileHistory` (ticket 02): only an `ok` history has
 * a `HEAD` to diff against; every other status disables the toggle with a
 * distinguishable reason. `null` = the history has not resolved yet (async).
 */
export type ReviewAvailability = { enabled: boolean; tooltip: string };

/** The tooltip shown when the review toggle IS available. */
export const REVIEW_ENABLED_TOOLTIP = 'Review changes since the last commit (HEAD)';

/**
 * Decide the review toggle's enabled state + tooltip from the open Concept's
 * `FileHistory`. Enabled only for `status: 'ok'`; each unavailable status maps
 * to an explanatory tooltip so the disabled button says WHY (not a repo /
 * untracked / no history / git missing). A `null` history (still loading) keeps
 * the toggle disabled with a neutral message.
 */
export function reviewAvailability(history: FileHistory | null): ReviewAvailability {
  if (history === null) {
    return { enabled: false, tooltip: 'Checking git history…' };
  }
  switch (history.status) {
    case 'ok':
      return { enabled: true, tooltip: REVIEW_ENABLED_TOOLTIP };
    case 'notARepo':
      return { enabled: false, tooltip: 'Not a git repository — nothing to review against' };
    case 'untracked':
      return { enabled: false, tooltip: 'File is untracked — no committed version to compare' };
    case 'noHistory':
      return { enabled: false, tooltip: 'No commits touch this file yet — nothing to review' };
    case 'gitMissing':
      return { enabled: false, tooltip: 'git is unavailable — cannot review changes' };
  }
}
