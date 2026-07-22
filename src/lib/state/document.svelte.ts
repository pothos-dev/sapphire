import { backend } from '$lib/ipc';
import { createDebouncer } from '$lib/debounce';
import { errMessage } from '$lib/errors';
import { remapPath } from '$lib/path';

/** Autosave debounce: save this long after the user stops typing. */
export const AUTOSAVE_DEBOUNCE_MS = 300;

/**
 * A Document owns the *content* of a single Concept — the editable buffer, its
 * dirty flag, Obsidian-like autosave, and the seam to the backend read/write.
 * Documents are addressable by bundle-relative path (via `DocumentRegistry`),
 * NOT owned 1:1 by a Tile: this is what lets a future second Tile attach to a
 * Concept that is already open and share its live buffer.
 *
 * Autosave: user edits flow in via `edit()`, which updates `content` and
 * schedules a debounced write (~300ms after typing stops). `flush()` writes
 * immediately (used on blur). There is no save button.
 *
 * External changes: `reloadExternal()` refreshes the buffer from disk when the
 * file changed on disk by another tool — but never clobbers unsaved local
 * edits. Sunstone's own writes are suppressed by the backend, so they never
 * arrive here (no reload loop or cursor jump). The removed-file case is a Tile
 * concern (it clears the view), so it lives in the workspace layer.
 */
export class Document {
  /** bundle-relative path of this Concept. Mutable: rewritten on a rename/move. */
  path = $state<string>('');
  /** raw markdown of the Concept (source of truth while editing). */
  content = $state<string>('');
  /** True when there are unsaved edits (a save is pending or in flight). */
  dirty = $state<boolean>(false);
  /** Last open/save error, if any. */
  error = $state<string | null>(null);

  /**
   * Optional hook invoked after a successful autosave, once the write has
   * landed. App wires this to slug-anchor rewriting: a save is the moment we
   * check whether any heading's slug changed and, if so, rewrite the inbound
   * anchors. Kept as a plain callback (not a rune) — it drives an imperative
   * side effect over the CodeMirror view, which the Document does not hold.
   */
  onSaved: ((path: string) => void) | null = null;

  /** Debounced autosave: writes the current content this long after edits stop. */
  #autosave = createDebouncer(() => void this.#save(), AUTOSAVE_DEBOUNCE_MS);

  constructor(path: string) {
    this.path = path;
  }

  /**
   * Load this Concept's raw markdown from disk into the buffer. On a read error
   * (e.g. a broken link to a missing Concept), surfaces the error in a graceful
   * state (empty buffer) instead of crashing.
   */
  async load(): Promise<void> {
    this.error = null;
    try {
      this.content = await backend.readConcept(this.path);
      this.dirty = false;
    } catch (e) {
      // Broken link / missing Concept: don't crash. Show a not-found state.
      this.content = '';
      this.dirty = false;
      this.error = errMessage(e);
    }
  }

  /**
   * Record a user edit and schedule a debounced autosave. Called by the CM6
   * change listener (App.svelte) on every keystroke.
   */
  edit(content: string): void {
    if (content === this.content) return;
    this.content = content;
    this.dirty = true;
    this.#autosave.schedule();
  }

  /** Write the current content to disk immediately (cancels the debounce). */
  async flush(): Promise<void> {
    this.#autosave.cancel();
    if (this.dirty) await this.#save();
  }

  async #save(): Promise<void> {
    if (!this.dirty) return;
    const content = this.content;
    const path = this.path;
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
   * Refresh the buffer from disk after an external filesystem change. Does
   * nothing if there are unsaved local edits (they must not be clobbered by the
   * external version). Clears any stale open/read error on a successful reload.
   */
  async reloadExternal(): Promise<void> {
    if (this.dirty) return;
    try {
      this.content = await backend.readConcept(this.path);
      // Clear any stale open/read error: the reload succeeded, so whatever was
      // wrong before (e.g. the file was missing when navigated to) is resolved.
      this.error = null;
    } catch (e) {
      this.error = errMessage(e);
    }
  }
}

/**
 * Addressable pool of open Documents, keyed by bundle-relative path. A Tile
 * asks the registry for the Document at a path (creating it lazily); a future
 * second Tile opening the same path gets the SAME Document instance, so they
 * share one live buffer. For the single-Tile workspace today this is effectively
 * the set of visited Concepts.
 */
export class DocumentRegistry {
  #docs = new Map<string, Document>();
  /** Propagated to every Document so autosaves reach App's slug-anchor rewrite. */
  #onSaved: ((path: string) => void) | null = null;

  /** Get (or lazily create) the Document for `path`. */
  get(path: string): Document {
    let doc = this.#docs.get(path);
    if (doc === undefined) {
      doc = new Document(path);
      doc.onSaved = this.#onSaved;
      this.#docs.set(path, doc);
    }
    return doc;
  }

  /** Set the post-save hook on all present and future Documents. */
  setOnSaved(cb: ((path: string) => void) | null): void {
    this.#onSaved = cb;
    for (const doc of this.#docs.values()) doc.onSaved = cb;
  }

  /** Forget the Document at `path` (e.g. after its file was removed on disk). */
  drop(path: string): void {
    this.#docs.delete(path);
  }

  /**
   * Re-key any Documents whose path IS `from` or sits beneath it (folder
   * rename/move), updating their `path` field so subsequent saves target the
   * new location.
   */
  rename(from: string, to: string): void {
    for (const [key, doc] of [...this.#docs]) {
      const next = remapPath(key, from, to);
      if (next !== null && next !== key) {
        this.#docs.delete(key);
        doc.path = next;
        this.#docs.set(next, doc);
      }
    }
  }
}
