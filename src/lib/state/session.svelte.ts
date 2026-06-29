import { backend } from '$lib/ipc';
import { createDebouncer } from '$lib/debounce';
import type { BundleState } from '$lib/types';
import type { RegionId } from '$lib/regionGrid';
import { flagsToClearOnEnter } from '$lib/transientReveal';

/**
 * Per-Bundle session state (slice: config-theme-state-store).
 *
 * The reusable seam over `Backend.loadBundleState` / `saveBundleState`: it holds
 * the restorable UI state (last-open Concept, expanded tree folders) as runes,
 * loads it on startup, and persists changes DEBOUNCED so rapid edits (typing a
 * path, toggling several folders) collapse into one write.
 *
 * Persistence is keyed (in the backend) by the Bundle's absolute path and lives
 * in the OS config folder — NEVER in the Bundle (CONTEXT.md). Window geometry is
 * owned by Rust; we carry the opaque `window` field through untouched so a save
 * here never clobbers it.
 *
 * EXTENDING (the `recentFiles` field below was added this way): add a rune +
 * accessor here, include it in `snapshot()`, and seed it in `load()`. The
 * Backend `BundleState` type and both impls already round-trip unknown fields,
 * so no seam change is needed beyond the new field.
 */

const SAVE_DEBOUNCE_MS = 250;

/** Max number of recent files retained (most-recent first). */
const RECENT_FILES_CAP = 15;

class SessionStore {
  /** bundle-relative path of the last-open Concept, or null. Restored on launch. */
  lastOpenConcept = $state<string | null>(null);
  /** bundle-relative folder paths currently expanded in the tree. */
  expandedFolders = $state<Set<string>>(new Set());
  /**
   * Bundle-relative paths of recently-opened Concepts, most-recent first.
   * Deduped and capped (~15). Powers the quick-nav palette's empty-input view.
   */
  recentFiles = $state<string[]>([]);
  /**
   * Sidebar collapse state (persist-sidebar-collapse-state). Each defaults to
   * `true` (expanded) on a fresh/older Bundle — `load()` seeds them from the
   * stored value, falling back to `true` when the field is absent, so no special
   * seeding is needed for a brand-new Bundle. `App.svelte` reads/writes these
   * through the accessors below instead of holding its own ephemeral `$state`.
   */
  leftSidebarOpen = $state<boolean>(true);
  explorerOpen = $state<boolean>(true);
  tagsOpen = $state<boolean>(true);
  backlinksOpen = $state<boolean>(true);
  /**
   * Right Sidebar collapse state (right-sidebar-move-backlinks). Unlike the
   * left-sidebar flags above this defaults to `false` (COLLAPSED) on a fresh
   * Bundle — the right Sidebar (Backlinks, later Outline) starts hidden and the
   * user opts in via the nav-bar right-track toggle.
   */
  rightSidebarOpen = $state<boolean>(false);
  /**
   * Outline section collapse state (outline-section). Defaults to `true`
   * (expanded) so the Outline shows the moment the right Sidebar is first
   * expanded — matching the left-Sidebar Sections' fresh-Bundle default.
   */
  outlineOpen = $state<boolean>(true);
  /**
   * Properties panel collapse state (persist-properties-collapse). A single
   * sticky preference mirroring the Sidebar Sections: defaults to `true`
   * (expanded) on a fresh/older Bundle, and the header chevron writes it through
   * `setPropertiesOpen` so the choice persists across Concept switches and
   * restarts. (Previously the panel kept this ephemerally in its component with a
   * per-Concept content default; it now lives here so it survives a reload.)
   */
  propertiesOpen = $state<boolean>(true);
  /**
   * EPHEMERAL transient-reveal flags (slice: transient-region-auto-reveal).
   * NEVER persisted — kept out of `#snapshot()`/`load()` deliberately. When
   * directional focus moves INTO a Region hidden only by a collapse (a folded
   * Sidebar or accordion-collapsed Section), the backbone flips the matching
   * flag here so the collapsible renders open and focus can land inside; on
   * focus truly leaving the Region the flag is cleared, snapping back to the
   * persisted `*Open` state. A Region stays open after a visit ONLY if it was
   * manually `*Open` BEFORE the visit (no in-visit pin).
   *
   * Effective visibility of a collapsible is therefore `*Open || transient*`.
   * We key the transient flags at the SAME granularity as the persisted ones
   * (the whole left/right Sidebar, and each Section) so a reveal opens exactly
   * the level that was hidden.
   */
  leftSidebarRevealed = $state<boolean>(false);
  rightSidebarRevealed = $state<boolean>(false);
  explorerRevealed = $state<boolean>(false);
  tagsRevealed = $state<boolean>(false);
  outlineRevealed = $state<boolean>(false);
  backlinksRevealed = $state<boolean>(false);
  /**
   * Properties panel transient reveal (slice: properties-auto-reveal). The
   * panel's persisted collapse lives in `propertiesOpen` above; this is the
   * ephemeral peek layered over it. Directional focus into a COLLAPSED Properties
   * panel flips this so the panel renders its body and focus can land in the
   * grid; focus leaving the Region clears it, snapping the panel back to its
   * persisted collapsed state.
   */
  propertiesRevealed = $state<boolean>(false);
  /**
   * True only after the FULL restore sequence (load + seed defaults + reopen the
   * last Concept) has completed. Persistence is gated on this so a reactive
   * `$effect` observing a transient default (e.g. `editor.path === null` before
   * the reopen resolves) cannot overwrite the just-loaded state. The app shell
   * sets it via `endRestore()` once restoration is done.
   */
  restored = $state<boolean>(false);

  /** Opaque window geometry from Rust; carried through saves untouched. */
  #window: unknown = undefined;
  /** Debounced persistence: coalesces rapid UI-state changes into one write. */
  #persist = createDebouncer(
    () => void backend.saveBundleState(this.#snapshot()).catch(() => {}),
    SAVE_DEBOUNCE_MS,
  );

  /** Load persisted state from the backend. Defaults on a missing/corrupt store. */
  async load(): Promise<void> {
    try {
      const state = await backend.loadBundleState();
      this.lastOpenConcept = state.lastOpenConcept ?? null;
      this.expandedFolders = new Set(state.expandedFolders ?? []);
      this.recentFiles = state.recentFiles ?? [];
      // Sidebar collapse flags default to `true` (expanded) when absent — a fresh
      // or older Bundle opens with the left Sidebar and every Section expanded.
      this.leftSidebarOpen = state.leftSidebarOpen ?? true;
      this.explorerOpen = state.explorerOpen ?? true;
      this.tagsOpen = state.tagsOpen ?? true;
      this.backlinksOpen = state.backlinksOpen ?? true;
      this.outlineOpen = state.outlineOpen ?? true;
      this.propertiesOpen = state.propertiesOpen ?? true;
      // The right Sidebar defaults to COLLAPSED (`false`) when absent — a fresh
      // or older Bundle opens with the right Sidebar hidden.
      this.rightSidebarOpen = state.rightSidebarOpen ?? false;
      this.#window = state.window;
    } catch {
      // Best-effort: a failed load just means no session to restore.
    }
  }

  /**
   * Mark restoration complete and persist once, capturing any defaults seeded
   * during startup (e.g. the fresh-Bundle default-open folders). After this,
   * `setExpanded` / `setLastOpenConcept` persist normally.
   */
  endRestore(): void {
    this.restored = true;
    this.#scheduleSave();
  }

  /** True if `path` is expanded. Used by Tree to seed each folder's state. */
  isExpanded(path: string): boolean {
    return this.expandedFolders.has(path);
  }

  /** Record a folder's expanded/collapsed state and schedule a persist. */
  setExpanded(path: string, expanded: boolean): void {
    const next = new Set(this.expandedFolders);
    if (expanded) next.add(path);
    else next.delete(path);
    this.expandedFolders = next;
    this.#scheduleSave();
  }

  /** Record the last-open Concept and schedule a persist. */
  setLastOpenConcept(path: string | null): void {
    if (path === this.lastOpenConcept) return;
    this.lastOpenConcept = path;
    this.#scheduleSave();
  }

  /**
   * Push an opened Concept to the front of the recent-files list (deduped,
   * capped at `RECENT_FILES_CAP`) and schedule a persist. Called whenever a
   * Concept is opened so the quick-nav palette's empty-input view stays current.
   */
  pushRecentFile(path: string): void {
    // Idempotent when `path` is already most-recent: this is called from a
    // reactive `$effect` tracking `editor.path`, so writing a fresh array on
    // every run (even an unchanged one) would re-trigger the effect — an update
    // loop. The early return keeps a no-op re-run a no-op.
    if (this.recentFiles[0] === path) return;
    const next = [path, ...this.recentFiles.filter((p) => p !== path)];
    if (next.length > RECENT_FILES_CAP) next.length = RECENT_FILES_CAP;
    this.recentFiles = next;
    this.#scheduleSave();
  }

  /** Record the left Sidebar's expanded/collapsed state and schedule a persist. */
  setLeftSidebarOpen(open: boolean): void {
    if (open === this.leftSidebarOpen) return;
    this.leftSidebarOpen = open;
    this.#scheduleSave();
  }

  /** Record the Explorer section's expanded/collapsed state and schedule a persist. */
  setExplorerOpen(open: boolean): void {
    if (open === this.explorerOpen) return;
    this.explorerOpen = open;
    this.#scheduleSave();
  }

  /** Record the Tags section's expanded/collapsed state and schedule a persist. */
  setTagsOpen(open: boolean): void {
    if (open === this.tagsOpen) return;
    this.tagsOpen = open;
    this.#scheduleSave();
  }

  /** Record the Backlinks section's expanded/collapsed state and schedule a persist. */
  setBacklinksOpen(open: boolean): void {
    if (open === this.backlinksOpen) return;
    this.backlinksOpen = open;
    this.#scheduleSave();
  }

  /** Record the right Sidebar's expanded/collapsed state and schedule a persist. */
  setRightSidebarOpen(open: boolean): void {
    if (open === this.rightSidebarOpen) return;
    this.rightSidebarOpen = open;
    this.#scheduleSave();
  }

  /** Record the Outline section's expanded/collapsed state and schedule a persist. */
  setOutlineOpen(open: boolean): void {
    if (open === this.outlineOpen) return;
    this.outlineOpen = open;
    this.#scheduleSave();
  }

  /** Record the Properties panel's expanded/collapsed state and schedule a persist. */
  setPropertiesOpen(open: boolean): void {
    if (open === this.propertiesOpen) return;
    this.propertiesOpen = open;
    this.#scheduleSave();
  }

  // --- Transient auto-reveal (slice: transient-region-auto-reveal) ---------
  //
  // Effective visibility of each collapsible: persisted `*Open` OR the
  // ephemeral transient flag. App.svelte's render + the Region `isVisible`
  // getters read THESE so a transiently-revealed Sidebar/Section both renders
  // open and is treated as visible by within-Region focus mirroring. Movement
  // reachability uses `isPresent` (content exists) instead — see the Region
  // registrations in App.svelte.

  /** Left Sidebar effectively shown (persisted-open or transiently revealed). */
  get leftSidebarVisible(): boolean {
    return this.leftSidebarOpen || this.leftSidebarRevealed;
  }
  /** Right Sidebar effectively shown. */
  get rightSidebarVisible(): boolean {
    return this.rightSidebarOpen || this.rightSidebarRevealed;
  }
  /** Explorer Section effectively expanded. */
  get explorerVisible(): boolean {
    return this.explorerOpen || this.explorerRevealed;
  }
  /** Tags Section effectively expanded. */
  get tagsVisible(): boolean {
    return this.tagsOpen || this.tagsRevealed;
  }
  /** Outline Section effectively expanded. */
  get outlineVisible(): boolean {
    return this.outlineOpen || this.outlineRevealed;
  }
  /** Backlinks Section effectively expanded. */
  get backlinksVisible(): boolean {
    return this.backlinksOpen || this.backlinksRevealed;
  }
  /** Properties panel effectively shown (persisted-open or transiently revealed). */
  get propertiesVisible(): boolean {
    return this.propertiesOpen || this.propertiesRevealed;
  }

  /**
   * Transiently reveal whatever collapse currently hides one of a Sidebar's
   * Sections, so directional focus can land inside it. Opens the whole Sidebar
   * if it was collapsed AND the Section if its accordion was collapsed — both
   * levels, since a reveal must end with the Section actually shown. Each flag
   * flips only when needed (so it doesn't clobber an already-open level into a
   * transient state, which would wrongly re-collapse it on focus-out).
   */
  revealLeftSection(section: 'explorer' | 'tags'): void {
    if (!this.leftSidebarOpen) this.leftSidebarRevealed = true;
    if (section === 'explorer' && !this.explorerOpen) this.explorerRevealed = true;
    if (section === 'tags' && !this.tagsOpen) this.tagsRevealed = true;
  }

  /** As `revealLeftSection`, for the right Sidebar (Outline / Backlinks). */
  revealRightSection(section: 'outline' | 'backlinks'): void {
    if (!this.rightSidebarOpen) this.rightSidebarRevealed = true;
    if (section === 'outline' && !this.outlineOpen) this.outlineRevealed = true;
    if (section === 'backlinks' && !this.backlinksOpen) this.backlinksRevealed = true;
  }

  /**
   * Transiently reveal the Properties panel (slice: properties-auto-reveal).
   * Called by the focus backbone only when directional movement targets a
   * present-but-collapsed Properties Region, so it can flip unconditionally — the
   * panel's effective collapse lives in its component, not here. Cleared on focus
   * leaving the Region via `clearTransientRevealsExcept`.
   */
  revealProperties(): void {
    this.propertiesRevealed = true;
  }

  /**
   * Snap transient reveals back to the persisted state when focus lands in
   * `entered`, KEEPING only the reveals that currently hold `entered` itself
   * shown. Called from the focus backbone on a region→different-region focusin
   * (see focus.svelte.ts). The "keep" set matters because focusing the
   * just-revealed Region fires the very focusin that triggers this clear — so
   * clearing indiscriminately would re-collapse the Region we just entered. We
   * therefore preserve exactly the flag(s) needed to keep `entered` visible and
   * clear every OTHER peeked Region.
   *
   * Never persisted — these flags are not in `#snapshot()`. `entered === null`
   * (focus left for an overlay / the body) is handled by the caller, which
   * simply does NOT call this, so an overlay round-trip preserves the peek.
   */
  clearTransientRevealsExcept(entered: RegionId): void {
    // The flags-to-clear decision is pure (transientReveal.ts) and unit-tested;
    // here we just apply it to the runes.
    for (const flag of flagsToClearOnEnter(entered)) this[flag] = false;
  }

  /** Current state as a plain `BundleState` for persistence. */
  #snapshot(): BundleState {
    return {
      lastOpenConcept: this.lastOpenConcept,
      expandedFolders: [...this.expandedFolders],
      recentFiles: [...this.recentFiles],
      leftSidebarOpen: this.leftSidebarOpen,
      explorerOpen: this.explorerOpen,
      tagsOpen: this.tagsOpen,
      backlinksOpen: this.backlinksOpen,
      rightSidebarOpen: this.rightSidebarOpen,
      outlineOpen: this.outlineOpen,
      propertiesOpen: this.propertiesOpen,
      window: this.#window,
    };
  }

  #scheduleSave(): void {
    // Never persist before the FULL restore sequence finishes (a transient
    // default observed mid-restore must not overwrite the just-loaded state).
    if (!this.restored) return;
    this.#persist.schedule();
  }
}

export const session = new SessionStore();
