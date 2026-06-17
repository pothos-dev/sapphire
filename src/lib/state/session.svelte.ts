import { backend } from '$lib/ipc';
import type { BundleState } from '$lib/types';

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
 * EXTENDING (slice 13 `recentFiles`): add a rune + accessor here, include it in
 * `snapshot()`, and seed it in `load()`. The Backend `BundleState` type and both
 * impls already round-trip unknown fields, so no seam change is needed beyond
 * the new field.
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
  /** True once `load()` has resolved (data available to render the tree). */
  loaded = $state<boolean>(false);
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
  /** Pending debounced-save timer. */
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

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
      // The right Sidebar defaults to COLLAPSED (`false`) when absent — a fresh
      // or older Bundle opens with the right Sidebar hidden.
      this.rightSidebarOpen = state.rightSidebarOpen ?? false;
      this.#window = state.window;
    } catch {
      // Best-effort: a failed load just means no session to restore.
    } finally {
      this.loaded = true;
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
      window: this.#window,
    };
  }

  #scheduleSave(): void {
    // Never persist before the FULL restore sequence finishes (a transient
    // default observed mid-restore must not overwrite the just-loaded state).
    if (!this.restored) return;
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void backend.saveBundleState(this.#snapshot()).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }
}

export const session = new SessionStore();
