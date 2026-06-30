import { dirname } from './path';

/**
 * Pure drop-legality rule for dragging tree rows into folders (slice: tree-dnd).
 * Kept DOM-free so it can be unit-tested; the `treeDnd` rune store
 * (`state/treeDnd.svelte.ts`) delegates here.
 *
 * Whether moving `from` into folder `toDir` is a legal drop. Rejects no-ops
 * (already in `toDir`) and the impossible cases of dropping a folder into itself
 * or one of its own descendants. A name collision in the target is left to the
 * backend, which surfaces it as a `treeActions` error. `toDir` is `''` for the
 * Bundle root.
 */
export function canDrop(from: string, toDir: string): boolean {
  if (from === '') return false; // the root itself is never draggable
  if (dirname(from) === toDir) return false; // already there
  if (toDir === from || toDir.startsWith(`${from}/`)) return false; // into self/descendant
  return true;
}
