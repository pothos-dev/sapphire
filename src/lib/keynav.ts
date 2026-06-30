// Shared keyboard-navigation predicates (pure; DOM-free, unit-testable).
//
// The Region keyboard handlers all gate on "no modifier keys held" so modified
// chords fall through to the global shell handler (Alt = Region move, Ctrl/Cmd
// = palettes/undo). This consolidates that one rule so the handlers agree.

/**
 * The modifier-key flags a keyboard event carries. `KeyboardEvent` satisfies
 * this shape; typing the subset keeps the predicate DOM-free and testable with
 * a plain object.
 */
export interface ModifierFlags {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether the event carries NO modifier keys (no Alt/Ctrl/Meta/Shift) — i.e. a
 * plain key press that a Region handler may claim for navigation.
 */
export function isPlainKey(e: ModifierFlags): boolean {
  return !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}
