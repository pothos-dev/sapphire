// App-wide keyboard-focus backbone (slice: region-focus-backbone).
//
// Owns the notion of the ACTIVE Region and directional movement between the six
// Regions of the 3×2 grid (see CONTEXT.md "Region" / "Focused item" and
// `$lib/regionGrid` for the grid geometry + movement math).
//
// DESIGN — DOM focus is the single source of truth:
//   `focusedRegion` is a rune that MIRRORS `document.activeElement` via
//   `focusin`/`focusout` listeners. It NEVER drives focus — it only reflects it,
//   so Svelte can reactively style the active Region. Movement actions
//   (`moveFocus`, `escapeToEditor`) imperatively call `.focus()` on a DOM
//   element; the resulting `focusin` then updates the rune. There is no parallel
//   logical-focus state to keep in sync.
//
// Each Region registers a container element plus a `focus()` callback (focuses
// its entry point — its remembered item, else its first focusable element) and
// an `isVisible()` predicate (collapsed / absent / empty Regions are skipped).
// The registry is keyed by RegionId; re-registration replaces the prior entry
// (a component remount during HMR or a Concept switch just updates it).

import {
  type RegionId,
  type Direction,
  REGION_CELL,
  ALL_REGIONS,
  move,
} from '$lib/regionGrid';

/** What a Region supplies when it registers with the focus backbone. */
export interface RegionRegistration {
  /** The Region's container element (used to attribute DOM focus to a Region). */
  container: HTMLElement;
  /**
   * Focus the Region's entry point: its remembered Focused item when still
   * connected, else its first focusable element / container. Called by the
   * movement actions. Returns true when focus was placed.
   */
  focus: () => boolean;
  /**
   * Whether the Region is currently focusable. Hidden Regions (collapsed,
   * absent like Properties with no Concept, or empty like Tags with no tags)
   * return false and are skipped by movement.
   */
  isVisible: () => boolean;
}

class FocusStore {
  /**
   * The active Region, mirrored from `document.activeElement`. `null` when focus
   * is outside every registered Region (e.g. an overlay, or the body). Reactive:
   * the app shell styles the active Region's container from this.
   */
  focusedRegion = $state<RegionId | null>(null);

  /** Live registry of Regions by id. */
  #regions = new Map<RegionId, RegionRegistration>();

  /**
   * Per-column sticky landing memory: the Region last focused in each column
   * (indexed by column 0..2). Moving left/right returns to this Region when it
   * is visible. Updated whenever a Region gains focus.
   */
  #columnMemory: Array<RegionId | null> = [null, null, null];

  #started = false;

  /** Register (or replace) a Region. Returns an unregister disposer. */
  register(id: RegionId, reg: RegionRegistration): () => void {
    this.#regions.set(id, reg);
    return () => {
      // Only remove if still the same registration (guards against an
      // out-of-order unmount during a remount replacing it).
      if (this.#regions.get(id) === reg) this.#regions.delete(id);
    };
  }

  /** True when a visible Region with this id is registered. */
  #isVisible = (id: RegionId): boolean => {
    const reg = this.#regions.get(id);
    return reg !== undefined && reg.isVisible();
  };

  /**
   * Start mirroring DOM focus into `focusedRegion`. Idempotent. Returns a
   * disposer that removes the listeners. Wired from the app shell's `onMount`.
   */
  start(): () => void {
    if (this.#started) return () => {};
    this.#started = true;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const id = this.#regionOf(target);
      this.focusedRegion = id;
      // Record the column the focus landed in as sticky landing memory.
      if (id) this.#columnMemory[REGION_CELL[id][0]] = id;
    };
    // A focusout with no incoming related target (focus left the document /
    // moved to a non-element) clears the active Region. When focus moves between
    // Regions, the matching focusin fires and re-sets it, so we only clear when
    // nothing is being focused.
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && this.#regionOf(next) !== null) return;
      if (!(next instanceof Node)) this.focusedRegion = null;
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      this.#started = false;
    };
  }

  /** Which registered Region contains `node`, or null. */
  #regionOf(node: Node): RegionId | null {
    for (const id of ALL_REGIONS) {
      const reg = this.#regions.get(id);
      if (reg && reg.container.contains(node)) return id;
    }
    return null;
  }

  /**
   * Move the active Region in `direction` (Alt+arrows / Alt+hjkl). Resolves the
   * destination via `regionGrid.move` (skipping hidden Regions, clamping at grid
   * edges, honouring sticky per-column landing), then focuses it. No-op when
   * focus is outside every Region or the move is clamped.
   */
  moveFocus(direction: Direction): void {
    const from = this.focusedRegion;
    if (from === null) return;
    const target = move(from, direction, this.#isVisible, this.#columnMemory);
    if (target === null) return; // clamped at an edge
    this.#regions.get(target)?.focus();
  }

  /**
   * Return focus to the Editor (home base) from any non-Editor Region. Basic
   * version of the escape-peel model (the full peel ordering is a later slice).
   * No-op when already in the Editor or the Editor is not registered/visible.
   */
  escapeToEditor(): void {
    if (this.focusedRegion === 'editor') return;
    const editor = this.#regions.get('editor');
    if (editor && editor.isVisible()) editor.focus();
  }
}

export const focus = new FocusStore();
