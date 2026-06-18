// Keyboard list-navigation math for the overlay palettes (pure; no DOM/state).
//
// Owns ONLY the activeIndex clamp + wrap-around arithmetic shared by the
// QuickNav palette and the full-text SearchPanel. Both render a vertical list
// where ↑/↓ move a highlighted selection (wrapping at the ends) and the
// selection is clamped into range when the result set shrinks. Callers keep
// their own `$state` / `$derived` / scroll-into-view wiring — this just removes
// the duplicated index math so the two stay in lockstep.

/**
 * Clamp a desired selection index into `[0, length)` without writing back to
 * state. With no items the result is 0. This is the "effective selection" the
 * UI highlights and Enter opens, derived from the user's raw `selected` intent.
 */
export function clampIndex(selected: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(selected, length - 1);
}

/** Next index with wrap-around (last → first). Returns 0 for an empty list. */
export function nextIndex(active: number, length: number): number {
  if (length === 0) return 0;
  return (active + 1) % length;
}

/** Previous index with wrap-around (first → last). Returns 0 for an empty list. */
export function prevIndex(active: number, length: number): number {
  if (length === 0) return 0;
  return (active - 1 + length) % length;
}
