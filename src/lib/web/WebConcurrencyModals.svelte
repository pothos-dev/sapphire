<script lang="ts">
  // Presentational-only surface for the web write concurrency UX (ticket 08):
  // the non-blocking "updated" notice, the deleted-state banner, and the three
  // blocking modals (conflict / leave / structural-op). Extracted from the
  // ticket-06 `WebEditorIsland` so both it and the full-App `WebAppShellIsland`
  // (WP3) render byte-identical markup + copy over the SAME `data-testid`s. All
  // decision logic + state machines stay in the islands; this is a thin switch
  // over the pure `concurrency.ts` copy helpers.
  import type { GatedStructuralOp } from './concurrency';
  import {
    conflictTitle,
    updatedNoticeText,
    deletedStateText,
    leavePromptText,
    structuralPromptText,
  } from './concurrency';

  interface Props {
    /** Short name (basename, no `.md`) of the active Concept, for modal copy. */
    conceptName: string;
    /** Non-blocking "updated by X" notice (clean external reload). */
    updated: { author: string | null; id: number } | null;
    /** Deleted-state banner: the active Concept was removed remotely (dirty). */
    deleted: { author: string | null } | null;
    /** Blocking conflict dialog: dirty buffer, active Concept changed remotely. */
    conflict: { author: string | null } | null;
    /** Three-way leave modal: unsaved edits on an implicit exit (presence only). */
    leave: unknown | null;
    /** Three-way structural-op modal: rename/move/delete while dirty. */
    structural: { op: GatedStructuralOp; target: string } | null;

    onConflictDiscard: () => void;
    onConflictKeep: () => void;
    onDeletedRecreate: () => void;
    onDeletedDiscard: () => void;
    onLeaveSave: () => void;
    onLeaveDiscard: () => void;
    onLeaveCancel: () => void;
    onStructuralSave: () => void;
    onStructuralDiscard: () => void;
    onStructuralCancel: () => void;
  }

  let {
    conceptName,
    updated,
    deleted,
    conflict,
    leave,
    structural,
    onConflictDiscard,
    onConflictKeep,
    onDeletedRecreate,
    onDeletedDiscard,
    onLeaveSave,
    onLeaveDiscard,
    onLeaveCancel,
    onStructuralSave,
    onStructuralDiscard,
    onStructuralCancel,
  }: Props = $props();
</script>

{#if updated}
  <div class="notice" data-testid="web-updated-notice" role="status">
    {updatedNoticeText(updated.author)}
  </div>
{/if}

{#if deleted}
  <div class="banner deleted" data-testid="web-deleted-state" role="alert">
    <span class="banner-msg">{deletedStateText(deleted.author)}</span>
    <span class="banner-actions">
      <button type="button" data-testid="web-deleted-save" onclick={onDeletedRecreate}
        >Save (re-create)</button
      >
      <button type="button" data-testid="web-deleted-discard" onclick={onDeletedDiscard}
        >Discard</button
      >
    </span>
  </div>
{/if}

<!-- Blocking conflict dialog: dirty buffer, active Concept changed remotely. -->
{#if conflict}
  <div class="modal-scrim" data-testid="web-conflict-modal" role="dialog" aria-modal="true">
    <div class="modal">
      <h2>{conflictTitle(conceptName, conflict.author)}</h2>
      <p>Your unsaved edits conflict with a newer version on the server.</p>
      <div class="modal-actions">
        <button type="button" data-testid="web-conflict-discard" onclick={onConflictDiscard}
          >Discard my changes &amp; reload</button
        >
        <button type="button" class="primary" data-testid="web-conflict-keep" onclick={onConflictKeep}
          >Keep my changes</button
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
        <button type="button" class="primary" data-testid="web-leave-save" onclick={onLeaveSave}
          >Save</button
        >
        <button type="button" data-testid="web-leave-discard" onclick={onLeaveDiscard}>Discard</button>
        <button type="button" data-testid="web-leave-cancel" onclick={onLeaveCancel}>Cancel</button>
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
        <button type="button" class="primary" data-testid="web-structural-save" onclick={onStructuralSave}
          >Save &amp; continue</button
        >
        <button type="button" data-testid="web-structural-discard" onclick={onStructuralDiscard}
          >Discard &amp; continue</button
        >
        <button type="button" data-testid="web-structural-cancel" onclick={onStructuralCancel}
          >Cancel</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  /* Non-blocking "updated by X" notice — a subtle floating pill (fixed so it
     works regardless of the host's positioning context). */
  .notice {
    position: fixed;
    top: 0.6rem;
    right: 0.8rem;
    z-index: 40;
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius-sm, 6px);
    background: var(--bg-elevated, #f0f2f6);
    border: 1px solid var(--border, #e2e2e2);
    color: var(--text-muted, #555);
    font-size: 0.8rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }

  /* Deleted-state banner — a fixed strip above the (orphaned) editor buffer. */
  .banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 45;
    display: flex;
    align-items: center;
    gap: 0.75rem;
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

  /* Blocking modal scrim + card, shared by all three dialogs. Sits ABOVE the
     Tree CRUD dialog (`.dialog`/`.dialog-backdrop`, z-index 1100/1101 in
     `TreeCrud.svelte`): a rename/move/delete over a dirty buffer opens that CRUD
     dialog first, then routes through the structural-op gate — whose modal must
     be the top-most, interactable layer, not trapped behind the CRUD backdrop. */
  .modal-scrim {
    position: fixed;
    inset: 0;
    z-index: 1200;
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
