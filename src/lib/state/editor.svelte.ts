import { backend } from '$lib/ipc';
import { createDebouncer } from '$lib/debounce';
import { errMessage } from '$lib/errors';
import { remapPath } from '$lib/path';

/** Autosave debounce: save this long after the user stops typing. */
const AUTOSAVE_DEBOUNCE_MS = 300;

/**
 * Editor state: which Concept is open, its content, and Obsidian-like autosave.
 *
 * Autosave: user edits flow in via `edit()`, which updates `content` and
 * schedules a debounced write (~300ms after typing stops). `flush()` writes
 * immediately (used on blur). There is no save button.
 *
 * External changes: `onExternalChange()` (wired in App.svelte to the backend
 * watcher) refreshes nothing itself but reloads the open Concept when its file
 * changed on disk by another tool. Sapphire's own writes are suppressed by the
 * backend, so they never arrive here — no reload loop or cursor jump.
 */
class EditorStore {
  /** bundle-relative path of the open Concept, or null if none. */
  path = $state<string | null>(null);
  /** raw markdown of the open Concept (source of truth while editing). */
  content = $state<string>('');
  /** Last open/save error, if any. */
  error = $state<string | null>(null);
  /** True when there are unsaved edits (a save is pending or in flight). */
  dirty = $state<boolean>(false);

  /**
   * Optional hook invoked after a successful autosave of `path`, once the write
   * has landed. App wires this to slug-anchor rewriting: a save is the moment we
   * check whether any heading's slug changed and, if so, rewrite the inbound
   * anchors. Kept as a plain callback (not a rune) — it drives an imperative
   * side effect over the CodeMirror view, which the store does not hold.
   */
  onSaved: ((path: string) => void) | null = null;

  /**
   * Browser-style navigation history of visited Concept paths. `history[index]`
   * is the current Concept. Opening a Concept (tree click or link) pushes onto
   * the stack, truncating any forward entries (standard browser semantics).
   * Back/Forward move `index` without re-pushing.
   */
  history = $state<string[]>([]);
  /** Index of the current entry in `history` (-1 when empty). */
  index = $state<number>(-1);

  /** True when there is a previous Concept to go Back to. */
  canGoBack = $derived(this.index > 0);
  /** True when there is a forward Concept to advance to. */
  canGoForward = $derived(this.index >= 0 && this.index < this.history.length - 1);

  /** Debounced autosave: writes the current content this long after edits stop. */
  #autosave = createDebouncer(() => void this.#save(), AUTOSAVE_DEBOUNCE_MS);

  /**
   * Open a Concept by bundle-relative path and load its raw markdown. This is
   * the navigation entry point for tree clicks and link clicks: it pushes a new
   * history entry (truncating forward history). Re-opening the already-current
   * Concept is a no-op (no duplicate history entry).
   */
  async open(path: string): Promise<void> {
    if (path === this.path) return;
    await this.#load(path);
    if (this.path !== path) return; // load failed; don't record history
    // Truncate forward history, then push the new entry as current.
    this.history = [...this.history.slice(0, this.index + 1), path];
    this.index = this.history.length - 1;
  }

  /** Go to the previous Concept in history, if any. */
  async back(): Promise<void> {
    if (!this.canGoBack) return;
    const target = this.history[this.index - 1];
    await this.#load(target);
    if (this.path === target) this.index -= 1;
  }

  /** Re-advance to the next Concept in history, if any. */
  async forward(): Promise<void> {
    if (!this.canGoForward) return;
    const target = this.history[this.index + 1];
    await this.#load(target);
    if (this.path === target) this.index += 1;
  }

  /**
   * Load a Concept's raw markdown into the editor WITHOUT touching history.
   * Flushes any pending autosave first so navigating never loses edits. On a
   * read error (e.g. a broken link to a missing Concept), surfaces the error in
   * a graceful state instead of crashing.
   */
  async #load(path: string): Promise<void> {
    // Flush any pending edits to the previously-open Concept first.
    await this.flush();

    this.error = null;
    try {
      const content = await backend.readConcept(path);
      this.path = path;
      this.content = content;
      this.dirty = false;
    } catch (e) {
      // Broken link / missing Concept: don't crash. Show a not-found state.
      this.path = path;
      this.content = '';
      this.dirty = false;
      this.error = errMessage(e);
    }
  }

  /**
   * Record a user edit from the editor and schedule a debounced autosave.
   * Called by the CM6 change listener (App.svelte) on every keystroke.
   */
  edit(content: string): void {
    if (this.path === null) return;
    if (content === this.content) return;
    this.content = content;
    this.dirty = true;
    this.#scheduleSave();
  }

  #scheduleSave(): void {
    this.#autosave.schedule();
  }

  /** Write the current content to disk immediately (cancels the debounce). */
  async flush(): Promise<void> {
    this.#autosave.cancel();
    if (this.dirty) await this.#save();
  }

  async #save(): Promise<void> {
    const path = this.path;
    if (path === null || !this.dirty) return;
    const content = this.content;
    try {
      await backend.writeConcept(path, content);
      // Only clear dirty if no newer edit arrived while the write was in flight.
      if (this.content === content) this.dirty = false;
      // The content is now on disk: let App reconcile slug-anchor changes (a
      // heading rename rewrites inbound anchors). Best-effort — never fail a save.
      this.onSaved?.(path);
    } catch (e) {
      this.error = errMessage(e);
    }
  }

  /**
   * Follow the open Concept across a rename/move. If the currently-open path
   * (or an ancestor folder of it) was renamed, rewrite `path` and the history
   * entries to the new location so the editor keeps pointing at the same
   * Concept (no spurious reload — the content is unchanged on disk). Called by
   * the tree-CRUD UI, which knows the from→to mapping (the watcher's separate
   * removed/created events cannot convey it). Returns the new open path, if any.
   */
  followRename(from: string, to: string): string | null {
    // Rewrite any affected history entries so Back/Forward stay valid.
    let changed = false;
    this.history = this.history.map((p) => {
      const next = remapPath(p, from, to);
      if (next !== null) changed = true;
      return next ?? p;
    });

    const openNext = this.path === null ? null : remapPath(this.path, from, to);
    if (openNext !== null) this.path = openNext;

    return changed || openNext !== null ? (this.path ?? null) : null;
  }

  /**
   * React to an external filesystem change. If the open Concept's file changed
   * on disk (by another tool), reload it so the editor reflects the new content;
   * if it was removed, clear the editor. Other paths are ignored here (the tree
   * refresh is handled separately in App.svelte).
   */
  async onExternalChange(kind: string, paths: string[]): Promise<void> {
    const open = this.path;
    if (open === null || !paths.includes(open)) return;

    if (kind === 'removed') {
      this.path = null;
      this.content = '';
      this.dirty = false;
      return;
    }

    // Don't clobber unsaved local edits with the external version.
    if (this.dirty) return;

    try {
      const content = await backend.readConcept(open);
      this.content = content;
      // Clear any stale open/read error: the reload succeeded, so whatever was
      // wrong before (e.g. the file was missing when navigated to) is resolved.
      this.error = null;
    } catch (e) {
      this.error = errMessage(e);
    }
  }
}

export const editor = new EditorStore();
