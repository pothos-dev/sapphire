import { canDrop } from '$lib/treeDnd';

/**
 * Shared state for dragging tree rows into folders (slice: tree-dnd).
 *
 * HTML5 drag-and-drop hides `dataTransfer` payloads during `dragover` (only the
 * available TYPES are exposed, not the data), so the recursive `Tree` rows can't
 * read the source path to decide whether a hovered folder is a legal drop. We
 * therefore carry the dragged path here, where every row and the root drop zone
 * can read it for both validation and the drop-target highlight.
 *
 * `dropTarget` uses `''` for the Bundle root (a real folder path) and `null` for
 * "nothing highlighted" — the two are distinct, so don't collapse them.
 */
class TreeDndStore {
  /** Bundle-relative path of the row being dragged, or `null` when idle. */
  dragging = $state<string | null>(null);
  /** Folder currently highlighted as the drop target (`''` = root), or `null`. */
  dropTarget = $state<string | null>(null);

  start(path: string): void {
    this.dragging = path;
  }

  /** Clear all drag state (on drop or `dragend`). */
  end(): void {
    this.dragging = null;
    this.dropTarget = null;
  }

  /** Whether moving `from` into folder `toDir` is a legal drop (see `$lib/treeDnd`). */
  canDrop(from: string, toDir: string): boolean {
    return canDrop(from, toDir);
  }
}

export const treeDnd = new TreeDndStore();
