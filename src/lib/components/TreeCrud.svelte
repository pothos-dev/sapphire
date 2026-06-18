<script lang="ts">
  /**
   * Tree CRUD feature (slice: tree-crud): the right-click context menu over
   * tree nodes plus the create / rename / move / delete confirmation dialogs.
   * Extracted out of App.svelte; the actual filesystem mutations live in the
   * `treeActions` store, which this component drives.
   *
   * Cross-feature coupling — `focusTypeForPath`: a freshly-created (non-reserved)
   * Concept should open with the Properties panel focused on its `type` field
   * (OKF validity), while a reserved file (index.md / log.md) is exempt and must
   * NOT focus-the-type. App owns the `focusTypeForPath` $state (plain navigation
   * also clears it); this component writes through the `$bindable` prop:
   * confirm-create-concept SETS it to the new path, create-reserved CLEARS it to
   * null. The set/clear stays end-to-end correct because the binding mutates
   * App's own state directly.
   */
  import type { TreeNode } from '$lib/types';
  import { dirname, joinPath } from '$lib/path';
  import {
    isReservedFile,
    reservedPath,
    RESERVED_FILES,
    type ReservedKind,
  } from '$lib/reserved';
  import { bundle } from '$lib/state/bundle.svelte';
  import { treeActions } from '$lib/state/treeActions.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';

  interface Props {
    /** App-owned focus-the-type request; bound so create-concept SETs it and
        create-reserved CLEARs it (see component header). */
    focusTypeForPath: string | null;
  }

  let { focusTypeForPath = $bindable() }: Props = $props();

  type Dialog =
    | { kind: 'newConcept' | 'newFolder' | 'rename'; node: TreeNode; value: string }
    | { kind: 'move'; node: TreeNode; value: string }
    | { kind: 'delete'; node: TreeNode };

  // The open context menu (right-click / per-row ⋯), or null.
  let menu = $state<{ node: TreeNode; x: number; y: number } | null>(null);
  // The open modal dialog (name prompt / move picker / delete confirm), or null.
  let dialog = $state<Dialog | null>(null);

  /**
   * Folder a NEW child of `node` should live in: the node itself if it's a
   * directory, else its containing folder.
   */
  function childDirOf(node: TreeNode): string {
    return node.isDir ? node.path : dirname(node.path);
  }

  /** All folder paths in the tree (for the Move picker), '' = Bundle root. */
  function folderPaths(node: TreeNode, out: string[] = []): string[] {
    if (node.isDir) {
      out.push(node.path);
      for (const child of node.children ?? []) folderPaths(child, out);
    }
    return out;
  }

  /** Open the context menu at viewport (x, y), targeting `node`. */
  export function openMenu(node: TreeNode, x: number, y: number) {
    menu = { node, x, y };
  }

  /** Whether `dir` (a folder node) already contains the reserved file `kind`. */
  function folderHasReserved(dir: TreeNode, kind: ReservedKind): boolean {
    const target = reservedPath(dir.path, kind);
    return (dir.children ?? []).some((c) => !c.isDir && c.path === target);
  }

  /**
   * Context-menu items for `node`. A FOLDER additionally offers to create
   * whichever reserved file (`index.md`/`log.md`) it is missing (slice:
   * reserved-files). The Bundle root counts as a folder here too.
   */
  function menuItemsFor(node: TreeNode) {
    const items: {
      id: string;
      label: string;
      separated?: boolean;
      danger?: boolean;
    }[] = [
      { id: 'newConcept', label: 'New Concept' },
      { id: 'newFolder', label: 'New Folder' },
    ];
    if (node.isDir) {
      const kinds: ReservedKind[] = ['index', 'log'];
      let first = true;
      for (const kind of kinds) {
        if (folderHasReserved(node, kind)) continue;
        items.push({
          id: `createReserved:${kind}`,
          label: `Create ${RESERVED_FILES[kind]}`,
          separated: first,
        });
        first = false;
      }
    }
    items.push(
      { id: 'rename', label: 'Rename', separated: true },
      { id: 'move', label: 'Move…' },
      { id: 'delete', label: 'Delete', separated: true, danger: true },
    );
    return items;
  }

  const menuItems = $derived(menu ? menuItemsFor(menu.node) : []);

  function onMenuSelect(id: string) {
    const node = menu?.node;
    if (!node) return;
    if (id === 'newConcept') dialog = { kind: 'newConcept', node, value: '' };
    else if (id === 'newFolder') dialog = { kind: 'newFolder', node, value: '' };
    else if (id.startsWith('createReserved:')) {
      const kind = id.slice('createReserved:'.length) as ReservedKind;
      const path = reservedPath(node.path, kind);
      focusTypeForPath = null; // reserved files have no `type` to focus.
      void treeActions.createReservedFile(node.path, kind, path);
    } else if (id === 'rename') dialog = { kind: 'rename', node, value: node.name };
    else if (id === 'move') dialog = { kind: 'move', node, value: dirname(node.path) };
    else if (id === 'delete') dialog = { kind: 'delete', node };
  }

  function closeDialog() {
    dialog = null;
  }

  async function confirmDialog() {
    if (!dialog) return;
    const d = dialog;
    if (d.kind === 'newConcept') {
      const name = d.value.trim();
      if (name === '') return;
      const file = name.endsWith('.md') ? name : `${name}.md`;
      const path = joinPath(childDirOf(d.node), file);
      const ok = await treeActions.createConcept(path);
      // Land in `type`: a scaffolded (non-reserved) Concept opens focused there.
      if (ok && !isReservedFile(path)) focusTypeForPath = path;
    } else if (d.kind === 'newFolder') {
      const name = d.value.trim();
      if (name === '') return;
      await treeActions.createFolder(joinPath(childDirOf(d.node), name));
    } else if (d.kind === 'rename') {
      const name = d.value.trim();
      if (name === '' || name === d.node.name) {
        closeDialog();
        return;
      }
      await treeActions.renamePath(d.node.path, joinPath(dirname(d.node.path), name));
    } else if (d.kind === 'move') {
      await treeActions.movePath(d.node.path, d.value);
    } else if (d.kind === 'delete') {
      await treeActions.deletePath(d.node.path);
    }
    closeDialog();
  }
</script>

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menuItems}
    onselect={onMenuSelect}
    onclose={() => (menu = null)}
  />
{/if}

{#if dialog}
  <div class="dialog-backdrop" role="presentation" onclick={closeDialog}></div>
  <div class="dialog" role="dialog" aria-modal="true" data-testid="tree-dialog">
    {#if dialog.kind === 'delete'}
      <p class="dialog-title">Delete “{dialog.node.name}”?</p>
      <p class="dialog-body">
        This {dialog.node.isDir ? 'folder and everything in it' : 'Concept'} will be
        permanently removed.
      </p>
      <div class="dialog-actions">
        <button type="button" onclick={closeDialog}>Cancel</button>
        <button
          type="button"
          class="danger"
          data-testid="dialog-confirm"
          onclick={confirmDialog}>Delete</button
        >
      </div>
    {:else if dialog.kind === 'move'}
      <p class="dialog-title">Move “{dialog.node.name}” to…</p>
      <select
        class="dialog-input"
        data-testid="dialog-move-target"
        bind:value={dialog.value}
      >
        {#each folderPaths(bundle.tree ?? { name: '', path: '', isDir: true, children: [] }) as dir (dir)}
          <option value={dir}>{dir === '' ? '/ (Bundle root)' : dir}</option>
        {/each}
      </select>
      <div class="dialog-actions">
        <button type="button" onclick={closeDialog}>Cancel</button>
        <button type="button" data-testid="dialog-confirm" onclick={confirmDialog}>Move</button>
      </div>
    {:else}
      <p class="dialog-title">
        {dialog.kind === 'newConcept'
          ? 'New Concept'
          : dialog.kind === 'newFolder'
            ? 'New Folder'
            : 'Rename'}
      </p>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="dialog-input"
        type="text"
        data-testid="dialog-input"
        placeholder={dialog.kind === 'newConcept' ? 'name (.md optional)' : 'name'}
        bind:value={dialog.value}
        autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void confirmDialog();
          }
        }}
      />
      <div class="dialog-actions">
        <button type="button" onclick={closeDialog}>Cancel</button>
        <button type="button" data-testid="dialog-confirm" onclick={confirmDialog}>
          {dialog.kind === 'rename' ? 'Rename' : 'Create'}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    background: rgba(16, 22, 18, 0.4);
  }

  .dialog {
    position: fixed;
    z-index: 1101;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: 300px;
    padding: 1.25rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .dialog-title {
    margin: 0 0 0.5rem;
    font-weight: 700;
  }

  .dialog-body {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .dialog-input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.65rem;
    margin-bottom: 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: inherit;
    font: inherit;
  }

  .dialog-input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .dialog-actions button {
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .dialog-actions button:hover {
    background: var(--hover);
  }

  .dialog-actions button.danger {
    color: var(--danger-contrast);
    background: var(--danger);
    border-color: var(--danger);
  }
</style>
