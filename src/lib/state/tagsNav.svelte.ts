// Tags Section keyboard-navigation state (slice: tags-multi-expand-keyboard-nav).
//
// Owns the Tags Region's Focused item — the keyboard cursor, a row in the
// two-level Tags tree (a tag root or a tagged-Concept leaf; docs/GLOSSARY.md "Focused
// item"). Like the Explorer, arrowing moves the Focused item without opening
// anything; only Enter on a leaf opens the Concept (and moves focus to the
// Editor). Tags has NO CRUD verbs — tags derive from frontmatter, so there is
// nothing to create/rename/delete here.
//
// This store holds ONLY the Focused-item key as a rune and the pure key-handling
// logic (delegating index math to `$lib/tagsNav`, which re-exports the generic
// clamp helpers from `$lib/treeNav`). It is DOM-free: TagBrowser.svelte drives
// DOM focus from `focusedKey` via roving tabindex + an effect, and supplies the
// side-effecting callbacks. Keeping it here mirrors `explorerNav`/`listFocusNav`.

import {
  flattenTagRows,
  indexOfKey,
  nextIndexClamped,
  prevIndexClamped,
  rowKey,
  type TagRow,
} from '$lib/tagsNav';
import type { TagCount } from '$lib/types';
import { isPlainKey } from '$lib/keynav';

/** Side-effects the handler invokes; supplied by TagBrowser.svelte. */
export interface TagsNavActions {
  /** Whether a tag is currently expanded. */
  isExpanded: (tag: string) => boolean;
  /** Set a tag's expanded state (drives the multi-expand Set + the per-tag query). */
  setExpanded: (tag: string, expanded: boolean) => void;
  /** Open a Concept and move focus to the Editor (Enter on a concept leaf). */
  openConcept: (path: string) => void;
}

class TagsNavStore {
  /**
   * Stable key of the Focused row (the roving-tabindex row), or null when
   * nothing is focused yet. A tag root is keyed by its tag, a concept leaf by
   * `tag path` (see `$lib/tagsNav.rowKey`). Set by arrowing, clicking a row, or
   * Home/End; NOT tied to the open Concept.
   */
  focusedKey = $state<string | null>(null);

  /** Make the row with `key` the Focused item (e.g. on click or programmatic focus). */
  setFocused(key: string): void {
    this.focusedKey = key;
  }

  /**
   * Handle a within-Tags keydown. Returns true when the key was handled (the
   * caller should then `preventDefault`). `tags` is the current tag list and
   * `actions` supplies expand + open side-effects. Movement uses the flattened
   * VISIBLE rows and CLAMPS at the ends (see `$lib/tagsNav`).
   *
   * `h/j/k/l` are unmodified here — unambiguous because cross-Region movement is
   * `Alt`+`hjkl` (handled by App's global capture handler, which runs first).
   * There are deliberately NO CRUD verbs in Tags.
   */
  handleKeydown(
    e: KeyboardEvent,
    tags: TagCount[],
    conceptsOf: (tag: string) => string[],
    actions: TagsNavActions,
  ): boolean {
    // Never claim modified chords: those belong to the global handler (Alt =
    // Region move, Ctrl/Cmd = palettes). Only plain keys navigate the tree.
    if (!isPlainKey(e)) return false;

    const rows = flattenTagRows(tags, actions.isExpanded, conceptsOf);
    if (rows.length === 0) return false;

    const current = indexOfKey(rows, this.focusedKey);
    const row: TagRow | undefined = current >= 0 ? rows[current] : undefined;

    switch (e.key) {
      case 'ArrowDown':
      case 'j': {
        this.focusedKey = rows[nextIndexClamped(current, rows.length)].key;
        return true;
      }
      case 'ArrowUp':
      case 'k': {
        this.focusedKey = rows[prevIndexClamped(current, rows.length)].key;
        return true;
      }
      case 'Home': {
        this.focusedKey = rows[0].key;
        return true;
      }
      case 'End': {
        this.focusedKey = rows[rows.length - 1].key;
        return true;
      }
      case 'ArrowRight':
      case 'l': {
        if (!row) {
          this.focusedKey = rows[0].key;
          return true;
        }
        if (row.isTag) {
          if (!row.expanded) {
            // collapsed tag → expand in place
            actions.setExpanded(row.tag, true);
          } else {
            // expanded tag → move into its first concept leaf (the next row,
            // which is this tag's first leaf when there is one)
            const next = rows[current + 1];
            if (next && !next.isTag && next.tag === row.tag) this.focusedKey = next.key;
          }
        }
        // concept leaf → no-op
        return true;
      }
      case 'ArrowLeft':
      case 'h': {
        if (!row) {
          this.focusedKey = rows[0].key;
          return true;
        }
        if (row.isTag) {
          // expanded tag → collapse; collapsed tag → no parent, stay put
          if (row.expanded) actions.setExpanded(row.tag, false);
        } else {
          // concept leaf → jump to its parent tag root
          this.focusedKey = rowKey(row.tag, null);
        }
        return true;
      }
      case 'Enter': {
        if (!row) return false;
        if (row.isTag) {
          actions.setExpanded(row.tag, !row.expanded);
        } else {
          // concept leaf → open the Concept AND move focus to the Editor
          actions.openConcept(row.path);
        }
        return true;
      }
      default:
        return false;
    }
  }
}

export const tagsNav = new TagsNavStore();
