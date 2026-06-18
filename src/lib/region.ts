// `use:region` Svelte action — wires a Region container to the focus backbone.
//
// Attaching `use:region={{ id, isVisible }}` to a Region's container element
// (a Section body, the Properties panel, etc.) does three things:
//   1. registers the Region with `focus` (state/focus.svelte.ts), so directional
//      movement and the active-Region mirror know it exists,
//   2. remembers the Region's last Focused item (the element inside the
//      container that last held focus) so re-entry restores it, and
//   3. implements the Region's `focus()` entry point: re-focus the remembered
//      item when still connected, else focus the first focusable descendant, and
//      as a last resort make the container itself focusable and focus it.
//
// The Editor Region does NOT use this action — its entry point is the existing
// CodeMirror `EditorView`, registered directly in App.svelte.
//
// Kept a plain action (no rune state of its own): `isVisible` is supplied as a
// getter the action calls on demand, so it always reads the caller's live
// reactive value without the action holding a copy.

import type { Action } from 'svelte/action';
import type { RegionId } from '$lib/regionGrid';
import { focus } from '$lib/state/focus.svelte';

export interface RegionParams {
  /** Which Region this container is. */
  id: RegionId;
  /**
   * Whether the Region is currently focusable. Read on demand (movement skips
   * hidden Regions), so pass a getter over reactive state, e.g.
   * `() => session.explorerOpen && hasRows`.
   */
  isVisible: () => boolean;
}

/** CSS selector for natively-focusable / tabindexed descendants. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function firstFocusable(container: HTMLElement): HTMLElement | null {
  // A focusable container itself wins (e.g. a roving-tabindex list root).
  if (container.matches(FOCUSABLE)) return container;
  return container.querySelector<HTMLElement>(FOCUSABLE);
}

export const region: Action<HTMLElement, RegionParams> = (node, params) => {
  let { id, isVisible } = params;

  // The Region's remembered Focused item: the descendant that last held focus.
  // Restored on re-entry so moving away and back returns to the same item.
  let remembered: HTMLElement | null = null;
  const onFocusIn = (e: FocusEvent) => {
    if (e.target instanceof HTMLElement && node.contains(e.target)) {
      remembered = e.target;
    }
  };
  node.addEventListener('focusin', onFocusIn);

  const focusEntry = (): boolean => {
    // Remembered item first, when still in the DOM and inside this container.
    if (remembered && node.contains(remembered) && remembered.isConnected) {
      remembered.focus();
      return true;
    }
    const first = firstFocusable(node);
    if (first) {
      first.focus();
      return true;
    }
    // Last resort: make the container itself focusable and focus it, so the
    // Region can still receive focus even with no focusable child yet.
    if (node.getAttribute('tabindex') === null) node.tabIndex = -1;
    node.focus();
    return true;
  };

  const dispose = focus.register(id, {
    container: node,
    focus: focusEntry,
    isVisible: () => isVisible(),
  });

  return {
    update(next: RegionParams) {
      // `id` is stable in practice, but keep both fresh so the registration
      // never goes stale across an `isVisible` getter change.
      id = next.id;
      isVisible = next.isVisible;
    },
    destroy() {
      node.removeEventListener('focusin', onFocusIn);
      dispose();
    },
  };
};
