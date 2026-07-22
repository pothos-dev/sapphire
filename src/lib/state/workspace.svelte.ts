import { remapPath } from '$lib/path';
import { Document, DocumentRegistry } from '$lib/state/document.svelte';
import {
  EMPTY_HISTORY,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  pushEntry,
  remapHistory,
  type NavHistory,
} from '$lib/state/navHistory';

/**
 * A Pane is a *view onto* Concepts: it holds the active Concept, this Pane's
 * navigation history, and (later) its scroll/cursor and view-mode. It attaches
 * to a Document — the buffer/autosave layer — via the shared `DocumentRegistry`,
 * so the same Concept opened in two Panes shares one live buffer.
 *
 * Navigation is browser-style (see `navHistory`): opening pushes a new entry
 * (truncating forward history), Back/Forward move the cursor. Re-opening the
 * already-current Concept is a no-op. Every navigation flushes the outgoing
 * Document's pending autosave first, so switching Concepts never loses edits.
 */
export class Pane {
  #registry: DocumentRegistry;

  /** bundle-relative path of the active Concept, or null if none. */
  activePath = $state<string | null>(null);
  /** This Pane's navigation history (immutable value; see navHistory.ts). */
  #history = $state<NavHistory>(EMPTY_HISTORY);

  constructor(registry: DocumentRegistry) {
    this.#registry = registry;
  }

  /** The Document backing the active Concept, or null when nothing is open. */
  get activeDocument(): Document | null {
    return this.activePath === null ? null : this.#registry.get(this.activePath);
  }

  /** Raw markdown of the active Concept ('' when nothing is open). */
  get content(): string {
    return this.activeDocument?.content ?? '';
  }

  /** Last open/save error of the active Concept, if any. */
  get error(): string | null {
    return this.activeDocument?.error ?? null;
  }

  /** True when the active Concept has unsaved edits. */
  get dirty(): boolean {
    return this.activeDocument?.dirty ?? false;
  }

  /** Visited Concept paths of this Pane (current entry at `index`). */
  get history(): readonly string[] {
    return this.#history.entries;
  }

  /** Cursor into `history` (-1 when empty). */
  get index(): number {
    return this.#history.index;
  }

  /** True when there is a previous Concept to go Back to. */
  get canGoBack(): boolean {
    return canGoBack(this.#history);
  }

  /** True when there is a forward Concept to advance to. */
  get canGoForward(): boolean {
    return canGoForward(this.#history);
  }

  /**
   * Open a Concept by bundle-relative path and load its raw markdown. Pushes a
   * new history entry (truncating forward history). Re-opening the
   * already-current Concept is a no-op (no duplicate history entry).
   */
  async open(path: string): Promise<void> {
    if (path === this.activePath) return;
    await this.#loadInto(path);
    if (this.activePath !== path) return; // load did not settle here; skip history
    this.#history = pushEntry(this.#history, path);
  }

  /** Go to the previous Concept in history, if any. */
  async back(): Promise<void> {
    if (!this.canGoBack) return;
    const target = this.#history.entries[this.#history.index - 1];
    await this.#loadInto(target);
    if (this.activePath === target) this.#history = goBack(this.#history);
  }

  /** Re-advance to the next Concept in history, if any. */
  async forward(): Promise<void> {
    if (!this.canGoForward) return;
    const target = this.#history.entries[this.#history.index + 1];
    await this.#loadInto(target);
    if (this.activePath === target) this.#history = goForward(this.#history);
  }

  /**
   * Attach the Pane to the Document at `path` and load it from disk. Flushes the
   * outgoing Document's pending autosave first so navigating never loses edits.
   */
  async #loadInto(path: string): Promise<void> {
    await this.activeDocument?.flush();
    const doc = this.#registry.get(path);
    await doc.load();
    this.activePath = path;
  }

  /** Record a user edit into the active Document (schedules autosave). */
  edit(content: string): void {
    this.activeDocument?.edit(content);
  }

  /** Flush the active Document's pending autosave to disk immediately. */
  async flush(): Promise<void> {
    await this.activeDocument?.flush();
  }

  /**
   * Follow the active Concept and history across a rename/move. Rewrites the
   * active path and any affected history entries to the new location, and
   * re-keys the backing Documents, so the Pane keeps pointing at the same
   * Concept (no reload — content is unchanged on disk). Returns the new active
   * path when anything was affected, else null.
   */
  followRename(from: string, to: string): string | null {
    const { history, changed } = remapHistory(this.#history, from, to);
    this.#history = history;

    const openNext = this.activePath === null ? null : remapPath(this.activePath, from, to);
    if (openNext !== null) this.activePath = openNext;

    this.#registry.rename(from, to);

    return changed || openNext !== null ? (this.activePath ?? null) : null;
  }

  /**
   * React to an external filesystem change on the active Concept. If it was
   * removed, detach the Pane (clearing the view); otherwise reload the buffer
   * from disk (unless there are unsaved local edits). Other paths are ignored
   * here — the tree refresh is handled separately in App.svelte.
   */
  async onExternalChange(kind: string, paths: string[]): Promise<void> {
    const open = this.activePath;
    if (open === null || !paths.includes(open)) return;

    if (kind === 'removed') {
      this.#registry.drop(open);
      this.activePath = null;
      return;
    }

    await this.activeDocument?.reloadExternal();
  }
}

/**
 * The workspace holds the Panes and the shared Document pool. For this slice it
 * holds EXACTLY ONE Pane, so the app behaves byte-identically to the previous
 * single `editor` singleton; later slices grow this to a tiling layout of Panes
 * over the same registry.
 */
export class Workspace {
  #registry = new DocumentRegistry();
  /** The single active Pane (until tiling adds more). */
  activePane: Pane = new Pane(this.#registry);

  /** Set the post-save hook on every Document in the pool. */
  setOnSaved(cb: ((path: string) => void) | null): void {
    this.#registry.setOnSaved(cb);
  }
}
