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
import {
  singlePaneLayout,
  allTileIds,
  columnId,
  splitRight as layoutSplitRight,
  splitDown as layoutSplitDown,
  closeTile as layoutCloseTile,
  resizeColumns as layoutResizeColumns,
  resizeTiles as layoutResizeTiles,
  MIN_WEIGHT,
  type Column,
  type Layout,
  type Tile,
} from '$lib/paneLayout';
import { rememberTile, type ColumnMemory } from '$lib/paneNav';
import { serializeLayout, type StoredLayout } from '$lib/state/layoutPersist';
import { DEFAULT_EDITOR_MODE, type EditorMode } from '$lib/editor/cm';

/** Monotonic Pane-id source: ids are opaque, stable, and never reused. */
let paneIdCounter = 0;
function nextPaneId(): string {
  return `pane-${++paneIdCounter}`;
}

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

  /** Opaque, stable id — the layout tree addresses this Pane by it. */
  readonly id: string;
  /** bundle-relative path of the active Concept, or null if none. */
  activePath = $state<string | null>(null);
  /**
   * This Pane's tri-state view-mode (Source / Live / Reading). Owned here (not in
   * the Pane.svelte component) so it is part of the persisted layout shape and
   * survives a relaunch. A fresh Pane defaults to `DEFAULT_EDITOR_MODE`; a split
   * inherits its source's mode; a restore sets it from the stored layout.
   */
  mode = $state<EditorMode>(DEFAULT_EDITOR_MODE);
  /** This Pane's navigation history (immutable value; see navHistory.ts). */
  #history = $state<NavHistory>(EMPTY_HISTORY);

  constructor(registry: DocumentRegistry, id: string = nextPaneId()) {
    this.#registry = registry;
    this.id = id;
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

  /**
   * Attach this Pane to a Concept that is ALREADY open in another Pane, WITHOUT
   * reloading it from disk. Used by Split Right / Split Down: the source Pane's
   * Document is live in the shared registry (and may carry unsaved edits), so a
   * `load()` would clobber the buffer. We just point at the same path — the
   * getter resolves to the same shared Document — and push a history entry so the
   * clone starts with its own one-entry history.
   */
  adopt(path: string): void {
    this.activePath = path;
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

  /**
   * Clear the Pane to its empty state: flush the outgoing Document's pending
   * autosave (so closing never loses edits), then detach the active Concept.
   * The navigation history is left intact — Back can still re-open the last
   * Concept. With a single Pane this returns the editor to the empty
   * "Select a Concept" placeholder.
   */
  async close(): Promise<void> {
    await this.activeDocument?.flush();
    this.activePath = null;
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
 * The workspace holds the Panes, the shared Document pool, and the TILING LAYOUT
 * — a row of columns, each a vertical stack of tiles (see `paneLayout.ts`). A
 * Pane is addressable by its id; the layout references those ids. Panes attach to
 * Documents via the shared registry, so the SAME Concept open in two tiles shares
 * one live buffer (an edit/autosave in one reflects in the others).
 *
 * `activeId` names the focused tile; `activePane` is the Pane the `editor` facade
 * (and thus Outline / Backlinks / Properties) tracks. Splitting clones the active
 * Pane's Concept into a new tile (adopting the shared Document without a reload);
 * closing a tile focuses a neighbour, and closing the last tile clears it to the
 * empty state (keeping the Pane + its history — Back can still re-open).
 */
export class Workspace {
  #registry = new DocumentRegistry();
  #panes = new Map<string, Pane>();

  /** The tiling layout (a row of columns of tiles), by Pane id. */
  layout = $state<Layout>({ columns: [] });
  /** The focused tile's Pane id. */
  activeId = $state<string>('');

  /**
   * Per-column sticky landing memory: the tile last focused in each column, by
   * column id (see `paneNav`). Updated whenever a tile becomes active, so
   * Alt+Left/Right movement returns to the tile you were last on in a column.
   * Plain field (not a rune): read only at movement time, nothing renders it.
   */
  #columnMemory: ColumnMemory = {};

  constructor() {
    const pane = this.#create();
    this.layout = singlePaneLayout(pane.id);
    this.activeId = pane.id;
  }

  #create(): Pane {
    const pane = new Pane(this.#registry);
    this.#panes.set(pane.id, pane);
    return pane;
  }

  /** The focused Pane (always a live Pane — the layout never has zero tiles). */
  get activePane(): Pane {
    const pane = this.#panes.get(this.activeId);
    // Defensive: fall back to any pane if the active id ever dangles.
    return pane ?? this.#panes.values().next().value!;
  }

  /** Look up a Pane by id (used by the layout renderer). */
  paneById(id: string): Pane | undefined {
    return this.#panes.get(id);
  }

  /** The per-column sticky landing memory (read by the Alt+arrow grid nav). */
  get columnMemory(): ColumnMemory {
    return this.#columnMemory;
  }

  /**
   * Make the tile `id` the focused/active Pane and record it as its column's
   * sticky tile. No-op for an unknown id.
   */
  setActive(id: string): void {
    if (!this.#panes.has(id)) return;
    this.activeId = id;
    this.#columnMemory = rememberTile(this.#columnMemory, this.layout, id);
  }

  /**
   * Split Right: clone the active Pane's Concept into a NEW COLUMN to the right,
   * and focus it. The clone adopts the shared Document (no reload). An empty
   * active Pane yields an empty new tile.
   */
  splitRight(): void {
    const source = this.activePane;
    const pane = this.#create();
    pane.mode = source.mode;
    if (source.activePath !== null) pane.adopt(source.activePath);
    this.layout = layoutSplitRight(this.layout, source.id, pane.id);
    this.activeId = pane.id;
  }

  /**
   * Split Down: clone the active Pane's Concept into a NEW TILE below it in the
   * current column, and focus it.
   */
  splitDown(): void {
    const source = this.activePane;
    const pane = this.#create();
    pane.mode = source.mode;
    if (source.activePath !== null) pane.adopt(source.activePath);
    this.layout = layoutSplitDown(this.layout, source.id, pane.id);
    this.activeId = pane.id;
  }

  /**
   * Close the tile `id`. The LAST remaining tile is cleared to its empty state
   * (Pane + history preserved — matching the single-Pane close), rather than
   * removed. A non-last tile is removed, its space redistributed, and a
   * neighbour focused if the closed tile was active.
   */
  async closePane(id: string): Promise<void> {
    const pane = this.#panes.get(id);
    if (!pane) return;
    if (allTileIds(this.layout).length <= 1) {
      await pane.close();
      return;
    }
    await pane.flush();
    const { layout, focusId } = layoutCloseTile(this.layout, id);
    this.#panes.delete(id);
    this.layout = layout;
    if (this.activeId === id && focusId !== null) this.activeId = focusId;
  }

  /** Drag the boundary between columns `index` and `index + 1` by `delta`. */
  resizeColumns(index: number, delta: number): void {
    this.layout = layoutResizeColumns(this.layout, index, delta, MIN_WEIGHT);
  }

  /** Drag the boundary between tiles `index`/`index + 1` in a column by `delta`. */
  resizeTiles(columnIndex: number, index: number, delta: number): void {
    this.layout = layoutResizeTiles(this.layout, columnIndex, index, delta, MIN_WEIGHT);
  }

  /**
   * Follow a rename/move across EVERY Pane (each rewrites its own active path +
   * history; the shared registry is re-keyed once). Returns the ACTIVE Pane's new
   * path when anything was affected, else null — the surface App/treeActions use.
   */
  followRename(from: string, to: string): string | null {
    let activeResult: string | null = null;
    for (const pane of this.#panes.values()) {
      const r = pane.followRename(from, to);
      if (pane.id === this.activeId) activeResult = r;
    }
    return activeResult;
  }

  /** Broadcast an external filesystem change to EVERY Pane. */
  async onExternalChange(kind: string, paths: string[]): Promise<void> {
    await Promise.all([...this.#panes.values()].map((p) => p.onExternalChange(kind, paths)));
  }

  /** Set the post-save hook on every Document in the pool. */
  setOnSaved(cb: ((path: string) => void) | null): void {
    this.#registry.setOnSaved(cb);
  }

  /**
   * Snapshot the workspace as a plain, ID-free `StoredLayout` for persistence:
   * every column (order + weight), every tile (order + weight + its Pane's
   * Concept path + view-mode) and the active tile. Thin over the pure
   * `serializeLayout`; reads the reactive layout/pane state so an `$effect`
   * observing it re-persists on any layout-relevant change.
   */
  snapshotLayout(): StoredLayout {
    return serializeLayout(this.layout, this.activeId, (id) => {
      const pane = this.#panes.get(id);
      return pane ? { path: pane.activePath, mode: pane.mode } : undefined;
    });
  }

  /**
   * Rebuild the workspace from a persisted `StoredLayout`: mint a fresh Pane per
   * stored tile, restore its view-mode, open its Concept (a missing/absent path
   * lands in the Pane's graceful not-found state — it never wedges startup), and
   * set the active tile. Per-pane navigation history and scroll/cursor are NOT
   * restored (out of scope): each Pane starts with a fresh one-entry history at
   * its Concept. Await resolves once every tile's Concept has loaded.
   */
  async restore(stored: StoredLayout): Promise<void> {
    this.#panes.clear();
    this.#columnMemory = {};
    const opens: Promise<void>[] = [];
    let activeId = '';

    const columns: Column[] = stored.columns.map((sc, ci) => {
      const tiles: Tile[] = sc.tiles.map((st, ti) => {
        const pane = this.#create();
        pane.mode = st.mode;
        // A stored path that no longer exists resolves to the Document's
        // not-found state (Document.load catches); swallow here so one bad tile
        // can't reject the whole restore.
        if (st.path !== null) opens.push(pane.open(st.path).catch(() => {}));
        if (ci === stored.active[0] && ti === stored.active[1]) activeId = pane.id;
        return { id: pane.id, weight: st.weight };
      });
      return { id: columnId(tiles[0].id), weight: sc.weight, tiles };
    });

    this.layout = { columns };
    this.activeId = activeId !== '' ? activeId : columns[0].tiles[0].id;
    await Promise.all(opens);
  }
}
