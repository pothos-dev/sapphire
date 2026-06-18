// Chip-strip index math for a Properties LIST value cell (pure; no DOM/state).
//
// A list/chip VALUE cell has a third focus depth (slice: properties-chip-
// subnavigation): once you Enter INTO the cell (chip sub-nav), focus rides a
// roving index across the strip `[chip 0][chip 1]…[chip n-1][+ new-tag input]`.
// The strip therefore has `chipCount + 1` focusable positions: indices
// `0..chipCount-1` are the chips, and index `chipCount` is the trailing
// new-tag input. Dropping in (Enter on the cell) always lands on index 0 —
// the first chip, or the new-tag input itself when the list is empty.
//
// This module owns ONLY the index arithmetic — where ←/→ land and which chip
// the focus moves to after a `d` delete. It is DOM-free and state-free: the
// `propertiesNav` store holds the focused index as a rune and applies these
// moves; PropertyRow.svelte mirrors the index into DOM focus.

/** Whether `index` addresses the trailing new-tag input (vs a chip). */
export function isNewTagIndex(index: number, chipCount: number): boolean {
  return index >= chipCount;
}

/**
 * Move the chip-strip cursor one step left/right over `chipCount` chips plus
 * the trailing new-tag input, CLAMPING at both ends (no wrap). The valid range
 * is `[0, chipCount]` — index `chipCount` is the new-tag input.
 */
export function moveChip(index: number, direction: 'left' | 'right', chipCount: number): number {
  if (direction === 'left') return Math.max(0, index - 1);
  return Math.min(chipCount, index + 1);
}

/**
 * The strip index to focus AFTER deleting the chip at `deletedIndex`, given the
 * list had `chipCount` chips BEFORE the delete (so `chipCount - 1` remain).
 *
 * Focus moves to a neighbour chip: the chip now occupying `deletedIndex` (the
 * old right neighbour shifts left into the slot), or the new last chip when the
 * deleted one was last. With no chips left, focus lands on the new-tag input
 * (index 0, which is also the new-tag index for an empty strip).
 */
export function indexAfterDelete(deletedIndex: number, chipCount: number): number {
  const remaining = chipCount - 1;
  if (remaining <= 0) return 0; // empty strip → the new-tag input (index 0)
  // Prefer the chip that slid into `deletedIndex`; clamp to the last chip.
  return Math.min(deletedIndex, remaining - 1);
}
