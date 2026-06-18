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
// two predicates that split the old single `isVisible` notion in two
// (slice: transient-region-auto-reveal):
//   - `isPresent()` — is there content to focus? FALSE for genuinely absent /
//     empty Regions (Properties with no open Concept, Tags with no tags). These
//     are SKIPPED by directional movement and never revealed.
//   - `isVisible()` — is the Region currently SHOWN (rendered, focusable right
//     now)? FALSE when a collapse hides it. A present-but-not-visible Region is
//     hidden only by a collapse, so movement can transiently REVEAL it.
// A Region hidden by a collapse therefore has `isPresent() === true` and
// `isVisible() === false`; directional movement into it calls its `reveal()`
// (flip the relevant transient flag) and then focuses it once it has rendered.
//
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
   * Whether there is content to focus here. FALSE only when the Region is
   * genuinely absent/empty (no open Concept → Properties/Outline/Backlinks; no
   * tags → Tags). Such Regions are SKIPPED by movement and never revealed. A
   * Region hidden merely by a collapse is still present (`true`).
   */
  isPresent: () => boolean;
  /**
   * Whether the Region is currently SHOWN — rendered and focusable right now.
   * FALSE when a collapse folds it away. Movement into a present-but-not-shown
   * Region transiently reveals it via `reveal()`.
   */
  isVisible: () => boolean;
  /**
   * Transiently reveal the collapse(s) hiding this Region so focus can land in
   * it. No-op when the Region is already shown. The flipped flag is ephemeral
   * (session store, never persisted) and cleared on focus-out (see
   * `#clearTransientOnLeave`). Optional: the Editor (never collapse-hidden)
   * omits it.
   */
  reveal?: () => void;
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

  /**
   * Sink called when focus TRULY lands in a Region DIFFERENT from the previous
   * one — App wires it to clear every transient reveal EXCEPT the ones keeping
   * `entered` shown (so the reveal we just performed to land here is not undone
   * by its own focusin). Kept as an injected callback (not a direct session
   * import) so this module stays free of session/UI knowledge and the
   * transient-reveal seam is explicit. The next slice
   * (escape-peel-restore-opener) drives the same focusin path; no extra wiring
   * is needed there.
   */
  onLeaveRegion: ((entered: RegionId) => void) | null = null;

  /** Register (or replace) a Region. Returns an unregister disposer. */
  register(id: RegionId, reg: RegionRegistration): () => void {
    this.#regions.set(id, reg);
    return () => {
      // Only remove if still the same registration (guards against an
      // out-of-order unmount during a remount replacing it).
      if (this.#regions.get(id) === reg) this.#regions.delete(id);
    };
  }

  /**
   * Reachability predicate for `regionGrid.move`: a Region is a valid movement
   * target when it is PRESENT (has content to focus), whether or not it is
   * currently shown. A present-but-collapsed Region is reached and then
   * transiently revealed; only absent/empty Regions (`isPresent() === false`)
   * are skipped.
   */
  #isPresent = (id: RegionId): boolean => {
    const reg = this.#regions.get(id);
    return reg !== undefined && reg.isPresent();
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
      const prev = this.focusedRegion;
      this.focusedRegion = id;
      // Record the column the focus landed in as sticky landing memory.
      if (id) this.#columnMemory[REGION_CELL[id][0]] = id;
      // Transient-reveal lifecycle (slice: transient-region-auto-reveal):
      // collapse any peeked Region only once focus TRULY lands in a DIFFERENT
      // registered Region. Focus moving to an overlay (QuickNav, Search) lands
      // OUTSIDE every Region, so `id === null` and we DON'T clear — that is how
      // a peek survives an overlay open/cancel round-trip. We also skip when
      // re-entering the same Region (`id === prev`). This focusin-based clear is
      // the seam the next slice (escape-peel-restore-opener) hooks: it restores
      // focus to the opener Region, whose focusin then clears the others.
      if (id !== null && id !== prev) this.onLeaveRegion?.(id);
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
   * destination via `regionGrid.move` over the PRESENCE predicate (absent/empty
   * Regions skipped, clamping at grid edges, honouring sticky per-column
   * landing). If the target is present but currently hidden by a collapse, it
   * is transiently REVEALED first, then focused once it has rendered. No-op when
   * focus is outside every Region or the move is clamped.
   */
  moveFocus(direction: Direction): void {
    const from = this.focusedRegion;
    if (from === null) return;
    const target = move(from, direction, this.#isPresent, this.#columnMemory);
    if (target === null) return; // clamped at an edge
    const reg = this.#regions.get(target);
    if (!reg) return;
    if (!reg.isVisible()) {
      // Present but collapse-hidden: reveal it, then focus once it has rendered.
      // Revealing flips a transient flag that drives a reactive re-render, so
      // the focusable target may not exist this tick — `#focusWhenVisible`
      // retries across animation frames (the codebase's standard pattern).
      reg.reveal?.();
      this.#focusWhenVisible(target);
      return;
    }
    reg.focus();
  }

  /**
   * Focus the Region `id`'s entry point once it has actually rendered after a
   * transient reveal. Re-reads the registration each attempt (a remount during
   * the reveal-driven re-render replaces it) and retries across a few animation
   * frames until the Region reports visible, mirroring `focusEditorWhenReady` /
   * the Explorer post-CRUD refocus in App.svelte. Gives up after a bounded
   * number of frames so a reveal that never materialises can't spin forever.
   */
  #focusWhenVisible(id: RegionId): void {
    let tries = 0;
    const attempt = () => {
      const reg = this.#regions.get(id);
      if (reg && reg.isVisible()) {
        reg.focus();
      } else if (tries++ < 10) {
        requestAnimationFrame(attempt);
      }
    };
    requestAnimationFrame(attempt);
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
