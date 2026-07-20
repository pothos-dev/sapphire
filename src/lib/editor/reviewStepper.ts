// Pure logic for the review-diff HISTORY STEPPER (issue 05).
//
// The review view (issue 04) shows one comparison at a time, rendered as
// CriticMarkup. The stepper walks BACKWARD through the open Concept's git
// history, one commit pair per step:
//
//   position 0 : Working tree ↔ HEAD      (what 04 shows by default)
//   position 1 : HEAD        ↔ HEAD~1
//   position 2 : HEAD~1      ↔ HEAD~2
//   …
//   position k : HEAD~(k-1)  ↔ HEAD~k
//
// This module holds the DOM-free, IPC-free INDEX math: given the file's commit
// list (newest first, from `Backend.fileHistory`, issue 02) and a step position,
// it computes the two revs to diff, the human label, the NEWER side's commit
// (for the bar's hash / subject / relative date), and whether each direction is
// still in bounds. `App.svelte` stays thin over it, and it is unit-tested over
// plain values (project convention: pure `.ts`, thin wiring elsewhere).

import type { FileCommit } from '$lib/types';

/**
 * The comparison to render at a given stepper position, plus the bar's display
 * data and the button-bounding flags. `App.svelte` reads `oldRev`/`newRev` to
 * fetch the two sides (`newRev === null` means the live working-tree buffer),
 * diffs them, and renders `label` + `newer` in the stepper bar.
 */
export interface ReviewStep {
  /** git rev for the OLDER (right-hand) side, e.g. `'HEAD'`, `'HEAD~1'`. */
  oldRev: string;
  /**
   * git rev for the NEWER (left-hand) side, or `null` when the newer side is
   * the working tree (position 0 — the live editor buffer, not a committed rev).
   */
  newRev: string | null;
  /** Human label for the comparison, e.g. `'Working tree ↔ HEAD'`, `'HEAD ↔ HEAD~1'`. */
  label: string;
  /**
   * The commit describing the NEWER side (its short hash / subject / relative
   * date drive the bar), or `null` at position 0 (the working tree has no commit).
   */
  newer: FileCommit | null;
  /** Whether stepping one further back (`← older`) is in bounds from here. */
  canOlder: boolean;
  /** Whether stepping one forward (`newer →`, toward the working tree) is in bounds. */
  canNewer: boolean;
}

/** The rev name for the commit `n` generations back from HEAD (`HEAD`, `HEAD~1`, …). */
function revName(n: number): string {
  return n === 0 ? 'HEAD' : `HEAD~${n}`;
}

/**
 * The highest valid stepper position for a file with these `commits`: position 0
 * (working ↔ HEAD) plus one per consecutive commit pair. With N commits the last
 * pair is `HEAD~(N-1) ↔ HEAD~N`… no — the OLDEST commit has no older parent in
 * this file's history, so the last comparison is `HEAD~(N-2) ↔ HEAD~(N-1)`,
 * giving positions `0 … N-1`. A single commit yields only position 0.
 */
export function maxStep(commits: FileCommit[]): number {
  return Math.max(0, commits.length - 1);
}

/**
 * Resolve the comparison at stepper `position`, clamped into `[0, maxStep]`.
 *
 * Position 0 diffs the working tree against `HEAD` (newer side = working tree,
 * no commit). Position k ≥ 1 diffs `HEAD~(k-1)` (newer) against `HEAD~k` (older),
 * so the bar shows `commits[k-1]` — the newer side's commit. `canOlder`/`canNewer`
 * bound the two step buttons at the ends of history.
 */
export function reviewStep(commits: FileCommit[], position: number): ReviewStep {
  const max = maxStep(commits);
  const pos = Math.max(0, Math.min(position, max));

  if (pos === 0) {
    return {
      oldRev: 'HEAD',
      newRev: null,
      label: 'Working tree ↔ HEAD',
      newer: null,
      canOlder: max > 0,
      canNewer: false,
    };
  }

  const newerRev = revName(pos - 1);
  const olderRev = revName(pos);
  return {
    oldRev: olderRev,
    newRev: newerRev,
    label: `${newerRev} ↔ ${olderRev}`,
    newer: commits[pos - 1] ?? null,
    canOlder: pos < max,
    canNewer: true,
  };
}
