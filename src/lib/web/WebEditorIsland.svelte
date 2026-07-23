<script module lang="ts">
  import type { GatedStructuralOp } from './concurrency';

  /**
   * The imperative surface the island hands back to `WebViewer` (via the
   * `onReady` prop) so the viewer's Edit toggle + tree navigation can drive the
   * buffer without reaching into the island's internals:
   *   - `requestDone` — the Edit-toggle click: Save if dirty, then exit to the
   *     rendered view (ticket 08 §4 — the toggle IS the save path, no dialog);
   *   - `tryLeave` — an implicit exit (switch Concept / toggle Edit off): resolve
   *     a dirty buffer through the three-way leave modal, then `proceed`;
   *   - `requestStructuralOp` — a rename/move/delete from the tree: gate on a
   *     clean active buffer (create is exempt), else the three-way structural
   *     modal, then `proceed`. Exposed for the tree-CRUD wiring that lands with
   *     the web tree write surface.
   */
  export interface WebEditorApi {
    requestDone(): void;
    tryLeave(proceed: () => void): void;
    requestStructuralOp(
      op: GatedStructuralOp | 'create',
      target: string,
      proceed: () => void | Promise<void>,
    ): void;
  }
</script>

<script lang="ts">
  // Client-only web editor island (tickets 06 + 08). WebViewer stays the SSR
  // read surface and reaches this component ONLY via a dynamic `import()` behind
  // an `onMount`/`browser` guard, so the desktop `Tile` (and, transitively,
  // CodeMirror / the atomic editor) never enters the SSR graph. This island then
  // dynamic-`import()`s `Tile.svelte` itself and constructs a single-Tile
  // `Workspace` for the open Concept against the `http` backend (seam already
  // wired). Desktop-only affordances (Region focus grid, tile split, layout
  // persistence, tree CRUD) are stubbed to minimal single-Tile state — the
  // focus/region system is NOT ported.
  //
  // The concurrency UX (ticket 08 §2-5) lives here as a THIN switch over the
  // pure `concurrency.ts` helpers: SSE change routing (refresh/reload/conflict/
  // deleted), the three-way leave modal, the beforeunload guard, and the
  // structural-op gate.
  import { onMount, tick } from 'svelte';
  import type { Component } from 'svelte';
  import { backend } from '$lib/ipc';
  import { indexStore } from '$lib/state/index.svelte';
  import type { Tile, Workspace } from '$lib/state/workspace.svelte';
  import type { FileChange } from '$lib/types';
  import {
    routeFileChange,
    structuralOpGated,
    conflictTitle,
    updatedNoticeText,
    deletedStateText,
    leavePromptText,
    structuralPromptText,
  } from './concurrency';

  interface Props {
    /** bundle-relative path of the Concept to edit (mount-time; forward-slash). */
    path: string;
    /** Leave edit mode → back to the SSR rendered view (WebViewer re-fetches). */
    onExit: () => void;
    /** Report the active buffer's dirtiness up (drives the Edit-toggle label). */
    onDirty: (dirty: boolean) => void;
    /** Hand the imperative API (above) to WebViewer once the island is live. */
    onReady: (api: WebEditorApi) => void;
  }

  let { path, onExit, onDirty, onReady }: Props = $props();

  // The lazily-loaded desktop editor component + its single-Tile state. Both are
  // resolved in `onMount` (client only) so nothing here is import-time heavy.
  let TileComponent = $state<Component | null>(null);
  let workspace = $state<Workspace | null>(null);
  let tile = $state<Tile | null>(null);

  // Short-name for the open Concept (basename, no `.md`) used in modal copy.
  const conceptName = $derived(basename(tile?.activePath ?? path));
  const dirty = $derived(tile?.dirty ?? false);

  // Mirror dirtiness up to WebViewer so the Edit toggle reads Save/Done.
  $effect(() => {
    onDirty(dirty);
  });

  function basename(p: string): string {
    const last = p.split('/').pop() ?? p;
    return last.replace(/\.md$/, '');
  }

  // --- Concurrency surfaces (all thin over concurrency.ts) --------------------
  let conflict = $state<{ author: string | null } | null>(null);
  let leave = $state<{ proceed: () => void } | null>(null);
  let structural = $state<{
    op: GatedStructuralOp;
    target: string;
    proceed: () => void | Promise<void>;
  } | null>(null);
  let deleted = $state<{ author: string | null } | null>(null);
  let updated = $state<{ author: string | null; id: number } | null>(null);
  let updatedSeq = 0;

  // Debounce a burst of external changes into a single (re-)raise of the
  // blocking conflict dialog (ticket 08 §3). "Keep my changes" clears it; a
  // further genuine change re-raises.
  let conflictBurst: ReturnType<typeof setTimeout> | null = null;

  function raiseConflict(author: string | null): void {
    if (conflictBurst) clearTimeout(conflictBurst);
    conflictBurst = setTimeout(() => {
      conflict = { author };
      conflictBurst = null;
    }, 120);
  }

  function showUpdatedNotice(author: string | null): void {
    updated = { author, id: ++updatedSeq };
  }

  // Auto-dismiss the non-blocking "updated" notice a few seconds after it shows.
  $effect(() => {
    if (!updated) return;
    const id = updated.id;
    const t = setTimeout(() => {
      if (updated?.id === id) updated = null;
    }, 4000);
    return () => clearTimeout(t);
  });

  // Route a genuine (non-echo — the http seam already drops our own) SSE change.
  function handleChange(change: FileChange): void {
    const active = tile?.activePath ?? null;
    const action = routeFileChange(change, active, tile?.dirty ?? false);
    switch (action.type) {
      case 'refresh':
        // Only other files changed: WebViewer's own subscription refreshes the
        // read-only chrome; here we just keep the editor's link index fresh.
        void indexStore.refresh();
        break;
      case 'reload':
        // Clean buffer: silent reload from disk + a non-blocking notice.
        void tile?.activeDocument?.reloadExternal();
        showUpdatedNotice(action.author);
        void indexStore.refresh();
        break;
      case 'conflict':
        raiseConflict(action.author);
        break;
      case 'deleted':
        if (!action.dirty) {
          // Clean buffer, nothing to reload to → drop back to the viewer.
          onExit();
        } else {
          // Dirty buffer becomes an orphan the user can re-create via Save.
          deleted = { author: action.author };
        }
        break;
    }
  }

  // --- Conflict dialog actions (ticket 08 §3) --------------------------------
  async function conflictDiscard(): Promise<void> {
    await tile?.activeDocument?.discardLocalEdits();
    conflict = null;
  }
  function conflictKeep(): void {
    // Dismiss; buffer stays dirty. The next Save overwrites their version
    // (last-write-wins); a further external change re-raises this dialog.
    conflict = null;
  }

  // --- Deleted state actions (ticket 08 §2) ----------------------------------
  async function deletedRecreate(): Promise<void> {
    // Save on a deleted path re-creates it (`create … via web`); buffer clean.
    await tile?.flush();
    deleted = null;
  }
  function deletedDiscard(): void {
    deleted = null;
    onExit();
  }

  // --- Three-way leave modal (ticket 08 §4) ----------------------------------
  async function leaveSave(): Promise<void> {
    const proceed = leave?.proceed;
    await tile?.flush();
    leave = null;
    proceed?.();
  }
  function leaveDiscard(): void {
    const proceed = leave?.proceed;
    leave = null;
    // The island unmounts on exit, discarding the in-memory buffer — no write.
    proceed?.();
  }
  function leaveCancel(): void {
    leave = null;
  }

  // --- Three-way structural-op modal (ticket 08 §5) --------------------------
  async function structuralSave(): Promise<void> {
    const s = structural;
    await tile?.flush();
    structural = null;
    await s?.proceed();
  }
  async function structuralDiscard(): Promise<void> {
    const s = structural;
    await tile?.activeDocument?.discardLocalEdits();
    structural = null;
    await s?.proceed();
  }
  function structuralCancel(): void {
    structural = null;
  }

  // --- The imperative API handed to WebViewer --------------------------------
  const api: WebEditorApi = {
    requestDone() {
      // The toggle click IS the save path when dirty; either way, exit after.
      void (async () => {
        if (tile?.dirty) await tile.flush();
        onExit();
      })();
    },
    tryLeave(proceed) {
      if (!tile?.dirty) proceed();
      else leave = { proceed };
    },
    requestStructuralOp(op, target, proceed) {
      if (op === 'create' || !structuralOpGated(op, tile?.dirty ?? false)) {
        void proceed();
        return;
      }
      structural = { op, target, proceed };
    },
  };

  onMount(() => {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;

    void (async () => {
      // Pull the desktop editor + workspace state in ONE dynamic step — this is
      // the SSR boundary: neither is ever statically imported into WebViewer.
      const [{ Workspace }, tileMod] = await Promise.all([
        import('$lib/state/workspace.svelte'),
        import('$lib/components/Tile.svelte'),
      ]);
      if (disposed) return;
      TileComponent = tileMod.default as unknown as Component;
      const ws = new Workspace();
      await ws.activeTile.open(path);
      if (disposed) return;
      workspace = ws;
      tile = ws.activeTile;
      // Seed the link index so broken-link + wikilink resolution work in-editor.
      void indexStore.refresh();
      await tick();
      onReady(api);
    })();

    // SSE routing for the active buffer (own echoes already dropped by the seam).
    unsubscribe = backend.onFileChanged(handleChange);

    // Tab close / reload guard — armed only while the buffer is dirty (§4).
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (tile?.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      disposed = true;
      unsubscribe?.();
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (conflictBurst) clearTimeout(conflictBurst);
    };
  });

  // Stubs for the desktop-only Tile affordances not ported to the web island.
  const noop = () => {};
</script>

<div class="web-editor" data-testid="web-editor">
  {#if updated}
    <div class="notice" data-testid="web-updated-notice" role="status">
      {updatedNoticeText(updated.author)}
    </div>
  {/if}

  {#if deleted}
    <div class="banner deleted" data-testid="web-deleted-state" role="alert">
      <span class="banner-msg">{deletedStateText(deleted.author)}</span>
      <span class="banner-actions">
        <button type="button" data-testid="web-deleted-save" onclick={deletedRecreate}
          >Save (re-create)</button
        >
        <button type="button" data-testid="web-deleted-discard" onclick={deletedDiscard}
          >Discard</button
        >
      </span>
    </div>
  {/if}

  {#if TileComponent && tile}
    <TileComponent
      {tile}
      active={true}
      multipleTiles={false}
      focusTypeForPath={null}
      onActivate={noop}
      onSplitRight={noop}
      onSplitDown={noop}
      onClose={onExit}
    />
  {:else}
    <p class="loading" data-testid="web-editor-loading">Loading editor…</p>
  {/if}
</div>

<!-- Blocking conflict dialog: dirty buffer, active Concept changed remotely. -->
{#if conflict}
  <div class="modal-scrim" data-testid="web-conflict-modal" role="dialog" aria-modal="true">
    <div class="modal">
      <h2>{conflictTitle(conceptName, conflict.author)}</h2>
      <p>Your unsaved edits conflict with a newer version on the server.</p>
      <div class="modal-actions">
        <button type="button" data-testid="web-conflict-discard" onclick={conflictDiscard}
          >Discard my changes &amp; reload</button
        >
        <button
          type="button"
          class="primary"
          data-testid="web-conflict-keep"
          onclick={conflictKeep}>Keep my changes</button
        >
      </div>
    </div>
  </div>
{/if}

<!-- Three-way leave modal: unsaved edits on an implicit exit. -->
{#if leave}
  <div class="modal-scrim" data-testid="web-leave-modal" role="dialog" aria-modal="true">
    <div class="modal">
      <h2>{leavePromptText(conceptName)}</h2>
      <div class="modal-actions">
        <button type="button" class="primary" data-testid="web-leave-save" onclick={leaveSave}
          >Save</button
        >
        <button type="button" data-testid="web-leave-discard" onclick={leaveDiscard}>Discard</button>
        <button type="button" data-testid="web-leave-cancel" onclick={leaveCancel}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<!-- Three-way structural-op modal: rename/move/delete while dirty. -->
{#if structural}
  <div class="modal-scrim" data-testid="web-structural-modal" role="dialog" aria-modal="true">
    <div class="modal">
      <h2>{structuralPromptText(structural.op, structural.target, conceptName)}</h2>
      <p>This action also updates links across the Bundle and can't run with unsaved changes open.</p>
      <div class="modal-actions">
        <button
          type="button"
          class="primary"
          data-testid="web-structural-save"
          onclick={structuralSave}>Save &amp; continue</button
        >
        <button type="button" data-testid="web-structural-discard" onclick={structuralDiscard}
          >Discard &amp; continue</button
        >
        <button type="button" data-testid="web-structural-cancel" onclick={structuralCancel}
          >Cancel</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .web-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }

  .loading {
    padding: 1rem;
    color: var(--text-muted, #777);
  }

  /* Non-blocking "updated by X" notice — a subtle floating pill. */
  .notice {
    position: absolute;
    top: 0.6rem;
    right: 0.8rem;
    z-index: 20;
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius-sm, 6px);
    background: var(--bg-elevated, #f0f2f6);
    border: 1px solid var(--border, #e2e2e2);
    color: var(--text-muted, #555);
    font-size: 0.8rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }

  /* Deleted-state banner — sits above the (orphaned) editor buffer. */
  .banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: none;
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #e2e2e2);
    font-size: 0.85rem;
  }

  .banner.deleted {
    background: var(--danger-soft, rgba(192, 57, 43, 0.12));
    color: var(--danger, #c0392b);
  }

  .banner-msg {
    flex: 1 1 auto;
    min-width: 0;
  }

  .banner-actions {
    display: flex;
    gap: 0.4rem;
    flex: none;
  }

  /* Blocking modal scrim + card, shared by all three dialogs. */
  .modal-scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
  }

  .modal {
    max-width: 26rem;
    margin: 1rem;
    padding: 1.1rem 1.25rem;
    border-radius: var(--radius, 10px);
    background: var(--bg, #fff);
    color: var(--text, #222);
    border: 1px solid var(--border, #e2e2e2);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  }

  .modal h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }

  .modal p {
    margin: 0 0 0.9rem;
    color: var(--text-muted, #666);
    font-size: 0.88rem;
  }

  .modal-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  button {
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border, #ccc);
    border-radius: var(--radius-sm, 6px);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  button:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  button.primary {
    background: var(--accent, #d9622b);
    border-color: var(--accent, #d9622b);
    color: #fff;
  }

  button.primary:hover {
    filter: brightness(1.05);
  }
</style>
