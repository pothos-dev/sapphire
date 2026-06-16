import { backend } from '$lib/ipc';
import { bundle } from '$lib/state/bundle.svelte';
import { editor } from '$lib/state/editor.svelte';
import { indexStore } from '$lib/state/index.svelte';
import { session } from '$lib/state/session.svelte';

/**
 * Orchestrates the document-tree CRUD operations (slice: tree-crud).
 *
 * Each action calls the Backend seam, then keeps the UI consistent:
 *  - the tree + broken-link index refresh (the real watcher's `file-changed`
 *    event also drives this, but we refresh here too so the change is PROMPT
 *    and the fake/real paths behave identically — `bundle.load()` is idempotent);
 *  - the open Concept FOLLOWS a rename/move (the watcher's separate
 *    removed/created events cannot convey the from→to mapping, so we do it here
 *    where the mapping is known), and session state is updated to match;
 *  - a deleted open Concept clears the editor gracefully.
 *
 * Last error is surfaced as a rune so the UI can show it.
 */
class TreeActionsStore {
  /** Last failed operation's message, if any (cleared on the next attempt). */
  error = $state<string | null>(null);

  /** Refresh the tree + index after a structural change. */
  async #refresh(): Promise<void> {
    await Promise.all([bundle.load(), indexStore.refresh()]);
  }

  /** Wrap an op: clear error, run, refresh, capture failures. */
  async #run(op: () => Promise<void>): Promise<boolean> {
    this.error = null;
    try {
      await op();
      await this.#refresh();
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /**
   * Create a new, empty Concept at `path` and open it. The minimal stub is an
   * empty file (rich scaffold is a later slice).
   */
  async createConcept(path: string): Promise<boolean> {
    const ok = await this.#run(() => backend.createConcept(path));
    if (ok) await editor.open(path);
    return ok;
  }

  /** Create a new folder at `path` (and expand it in the tree). */
  async createFolder(path: string): Promise<boolean> {
    const ok = await this.#run(() => backend.createFolder(path));
    if (ok) session.setExpanded(path, true);
    return ok;
  }

  /**
   * Rename/move `from` to `to`. The open Concept follows OPTIMISTICALLY, BEFORE
   * the backend call: the backend's structural change emits a `removed` event
   * for `from`, and if the editor still pointed at `from` when that arrived it
   * would clear itself. Remapping first means the editor already points at `to`,
   * so the `removed` event no longer matches and the editor keeps its content.
   * On failure we roll the open path back.
   */
  async renamePath(from: string, to: string): Promise<boolean> {
    const before = editor.path;
    this.#followRename(from, to);
    const ok = await this.#run(() => backend.renamePath(from, to));
    if (!ok && before !== null) this.#followRename(to, before);
    return ok;
  }

  /** Move `from` into the folder `toDir` (keeping its name), following the open Concept. */
  async movePath(from: string, toDir: string): Promise<boolean> {
    const name = from.split('/').filter(Boolean).pop() ?? from;
    const to = toDir === '' ? name : `${toDir.replace(/\/+$/, '')}/${name}`;
    const before = editor.path;
    this.#followRename(from, to);
    const ok = await this.#run(() => backend.movePath(from, toDir));
    if (!ok && before !== null) this.#followRename(to, before);
    return ok;
  }

  /** Delete `path` (file or folder). A deleted open Concept clears the editor. */
  async deletePath(path: string): Promise<boolean> {
    return this.#run(() => backend.deletePath(path));
    // The editor clears via App.svelte's `onExternalChange('removed', ...)`
    // wired to the watcher event the fake/real backends both emit on delete.
  }

  /** Apply a rename to the open Concept + history + session. */
  #followRename(from: string, to: string): void {
    const newOpen = editor.followRename(from, to);
    if (newOpen !== null && session.restored) {
      session.setLastOpenConcept(newOpen);
    }
  }
}

export const treeActions = new TreeActionsStore();
