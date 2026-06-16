import { backend } from '$lib/ipc';

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
 * changed on disk by another tool. Emerald's own writes are suppressed by the
 * backend, so they never arrive here — no reload loop or cursor jump.
 */
class EditorStore {
  /** bundle-relative path of the open Concept, or null if none. */
  path = $state<string | null>(null);
  /** raw markdown of the open Concept (source of truth while editing). */
  content = $state<string>('');
  /** True while a Concept is loading. */
  loading = $state<boolean>(false);
  /** Last open/save error, if any. */
  error = $state<string | null>(null);
  /** True when there are unsaved edits (a save is pending or in flight). */
  dirty = $state<boolean>(false);

  /**
   * Navigation history stub. Slice 5 turns this into real back/forward
   * navigation; for now we just record the trail of opened Concepts.
   */
  history = $state<string[]>([]);

  /** Pending debounced-save timer. */
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Open a Concept by bundle-relative path and load its raw markdown. */
  async open(path: string): Promise<void> {
    // Flush any pending edits to the previously-open Concept first.
    await this.flush();

    this.loading = true;
    this.error = null;
    try {
      const content = await backend.readConcept(path);
      this.path = path;
      this.content = content;
      this.dirty = false;
      this.history.push(path);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
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
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#save();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** Write the current content to disk immediately (cancels the debounce). */
  async flush(): Promise<void> {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
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
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
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
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

export const editor = new EditorStore();
