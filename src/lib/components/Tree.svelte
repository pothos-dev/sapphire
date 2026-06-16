<script lang="ts">
  import type { TreeNode } from '$lib/types';
  import { session } from '$lib/state/session.svelte';
  import { isReservedFile, reservedKind, RESERVED_FILES, type ReservedKind } from '$lib/reserved';
  import Self from './Tree.svelte';

  interface Props {
    node: TreeNode;
    /** path of the currently-open Concept, for highlighting */
    selected: string | null;
    /** called when a `.md` file is clicked */
    onopen: (path: string) => void;
    /** called on right-click (or the per-row menu button) with the node + coords */
    onmenu: (node: TreeNode, x: number, y: number) => void;
    /** depth for indentation (root's children start at 0) */
    depth?: number;
  }

  let { node, selected, onopen, onmenu, depth = 0 }: Props = $props();

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onmenu(node, e.clientX, e.clientY);
  }

  // Expanded state is owned by the session store (persisted per-Bundle, restored
  // on launch). The store is seeded with the default-open folders (depth < 2) on
  // startup for a fresh Bundle, so reading it here gives both the restored set
  // and the sensible default. Toggling reports back to the store, which persists.
  const expanded = $derived(node.isDir && session.isExpanded(node.path));

  const indent = $derived(depth * 12);

  function toggle() {
    session.setExpanded(node.path, !expanded);
  }

  const isMarkdown = $derived(!node.isDir && node.name.toLowerCase().endsWith('.md'));

  // Reserved files (`index.md`/`log.md`) are NOT shown as ordinary tree leaves;
  // they are surfaced as per-folder affordances on the containing folder row
  // instead. Strip them from the normal child listing here (slice: reserved-files).
  const ordinaryChildren = $derived(
    (node.children ?? []).filter((c) => c.isDir || !isReservedFile(c.path)),
  );

  // The reserved files this folder directly contains, in a stable order, each as
  // { kind, path } so the affordance can open it. The icon opens it like any
  // other Concept (normal markdown editing — no special rendered view).
  const RESERVED_ORDER: ReservedKind[] = ['index', 'log'];
  const reservedAffordances = $derived(
    node.isDir
      ? (node.children ?? [])
          .filter((c) => !c.isDir && isReservedFile(c.path))
          .map((c) => ({ kind: reservedKind(c.path) as ReservedKind, path: c.path }))
          .sort((a, b) => RESERVED_ORDER.indexOf(a.kind) - RESERVED_ORDER.indexOf(b.kind))
      : [],
  );

  /** A small glyph per reserved kind for the folder-row affordance. */
  const RESERVED_GLYPH: Record<ReservedKind, string> = { index: '☰', log: '🕑' };
</script>

{#if node.isDir}
  <div class="row dir" style="padding-left: {indent}px" oncontextmenu={openMenu} role="treeitem" aria-selected="false" tabindex="-1">
    <button class="entry dir-toggle" type="button" onclick={toggle} aria-expanded={expanded}>
      <span class="twisty" class:open={expanded}>▸</span>
      <span class="name">{node.name}</span>
    </button>
    <!-- Reserved-file affordances: click an icon to open the folder's index.md /
         log.md directly (they are stripped from the ordinary leaf listing). -->
    {#each reservedAffordances as r (r.path)}
      <button
        class="reserved-btn"
        class:selected={selected === r.path}
        type="button"
        title={`Open ${RESERVED_FILES[r.kind]}`}
        aria-label={`Open ${RESERVED_FILES[r.kind]}`}
        data-reserved-path={r.path}
        data-reserved-kind={r.kind}
        onclick={(e) => {
          e.stopPropagation();
          onopen(r.path);
        }}
      >{RESERVED_GLYPH[r.kind]}</button>
    {/each}
    <button
      class="menu-btn"
      type="button"
      title="Actions"
      aria-label="Folder actions"
      data-menu-path={node.path}
      onclick={openMenu}
    >⋯</button>
  </div>
  {#if expanded}
    <ul class="children">
      {#each ordinaryChildren as child (child.path)}
        <li>
          <Self node={child} {selected} {onopen} {onmenu} depth={depth + 1} />
        </li>
      {/each}
    </ul>
  {/if}
{:else}
  <div class="row file" style="padding-left: {indent}px" oncontextmenu={openMenu} role="treeitem" aria-selected={selected === node.path} tabindex="-1">
    <button
      class="entry file-entry"
      class:selected={selected === node.path}
      class:nonmd={!isMarkdown}
      type="button"
      disabled={!isMarkdown}
      data-path={node.path}
      onclick={() => isMarkdown && onopen(node.path)}
    >
      <span class="name">{node.name}</span>
    </button>
    <button
      class="menu-btn"
      type="button"
      title="Actions"
      aria-label="Concept actions"
      data-menu-path={node.path}
      onclick={openMenu}
    >⋯</button>
  </div>
{/if}

<style>
  .children {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
  }

  .reserved-btn {
    flex: 0 0 auto;
    width: 1.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.55;
  }

  .reserved-btn:hover {
    background: rgba(127, 127, 127, 0.2);
    opacity: 1;
  }

  .reserved-btn.selected {
    opacity: 1;
    background: rgba(80, 140, 255, 0.25);
  }

  .menu-btn {
    flex: 0 0 auto;
    visibility: hidden;
    width: 1.5rem;
    margin-right: 0.2rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.7;
  }

  .row:hover .menu-btn {
    visibility: visible;
  }

  .menu-btn:hover {
    background: rgba(127, 127, 127, 0.2);
    opacity: 1;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.15rem 0.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
  }

  .entry:hover:not(:disabled) {
    background: rgba(127, 127, 127, 0.15);
  }

  .file-entry.selected {
    background: rgba(80, 140, 255, 0.25);
  }

  .file-entry.nonmd {
    cursor: default;
    opacity: 0.5;
  }

  .twisty {
    display: inline-block;
    width: 1em;
    transition: transform 0.1s ease;
    color: #888;
  }

  .twisty.open {
    transform: rotate(90deg);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dir .name {
    font-weight: 600;
  }
</style>
