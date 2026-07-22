import { Workspace } from '$lib/state/workspace.svelte';
import type { Pane } from '$lib/state/workspace.svelte';

/**
 * Editor facade: the stable surface App.svelte and the tree-CRUD flow use to
 * drive the open Concept, its autosave, and navigation history.
 *
 * Behind it the state is split into two layers (slice: document-pane-state-split):
 *  - a **Document** owns a Concept's buffer, dirty flag, autosave and disk IO,
 *    addressable by path via a `DocumentRegistry`;
 *  - a **Pane** owns the active Concept, navigation history and view state, and
 *    attaches to a Document.
 *
 * This facade delegates to the workspace's single active Pane, so the app
 * behaves byte-identically to the previous `editor` singleton. Later slices add
 * more Panes; the facade stays the "focused / active Pane" accessor.
 */
class EditorStore {
  #workspace = new Workspace();

  /**
   * The tiling workspace behind the facade. App.svelte reads this to render the
   * layout tree (row of columns of Panes) and to drive split/close/resize/active
   * — everything that operates on MORE than the single active Pane. The facade
   * getters/methods below stay the "active Pane" surface every existing call site
   * relies on, so they keep working unchanged.
   */
  get workspace(): Workspace {
    return this.#workspace;
  }

  get #pane(): Pane {
    return this.#workspace.activePane;
  }

  /** bundle-relative path of the open Concept, or null if none. */
  get path(): string | null {
    return this.#pane.activePath;
  }

  /** raw markdown of the open Concept (source of truth while editing). */
  get content(): string {
    return this.#pane.content;
  }

  /** Last open/save error, if any. */
  get error(): string | null {
    return this.#pane.error;
  }

  /** True when there are unsaved edits (a save is pending or in flight). */
  get dirty(): boolean {
    return this.#pane.dirty;
  }

  /** Visited Concept paths; `history[index]` is the current Concept. */
  get history(): readonly string[] {
    return this.#pane.history;
  }

  /** Index of the current entry in `history` (-1 when empty). */
  get index(): number {
    return this.#pane.index;
  }

  /** True when there is a previous Concept to go Back to. */
  get canGoBack(): boolean {
    return this.#pane.canGoBack;
  }

  /** True when there is a forward Concept to advance to. */
  get canGoForward(): boolean {
    return this.#pane.canGoForward;
  }

  /**
   * Optional hook invoked after a successful autosave, once the write has
   * landed (App wires this to slug-anchor rewriting). Propagated to every
   * Document in the workspace.
   */
  set onSaved(cb: ((path: string) => void) | null) {
    this.#workspace.setOnSaved(cb);
  }

  /**
   * Open a Concept by bundle-relative path and load its raw markdown. Pushes a
   * new history entry (truncating forward history). Re-opening the current
   * Concept is a no-op.
   */
  open(path: string): Promise<void> {
    return this.#pane.open(path);
  }

  /** Go to the previous Concept in history, if any. */
  back(): Promise<void> {
    return this.#pane.back();
  }

  /** Re-advance to the next Concept in history, if any. */
  forward(): Promise<void> {
    return this.#pane.forward();
  }

  /** Clear the active Pane to its empty state (flushing any pending autosave). */
  close(): Promise<void> {
    return this.#pane.close();
  }

  /** Record a user edit and schedule a debounced autosave. */
  edit(content: string): void {
    this.#pane.edit(content);
  }

  /** Write the current content to disk immediately (cancels the debounce). */
  flush(): Promise<void> {
    return this.#pane.flush();
  }

  /** Follow the open Concept + history across a rename/move (ALL Panes). */
  followRename(from: string, to: string): string | null {
    return this.#workspace.followRename(from, to);
  }

  /** React to an external filesystem change on the open Concept (ALL Panes). */
  onExternalChange(kind: string, paths: string[]): Promise<void> {
    return this.#workspace.onExternalChange(kind, paths);
  }
}

export const editor = new EditorStore();
