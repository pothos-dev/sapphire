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
    /** called on right-click with the node + coords */
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

  // The tree shows only Concepts (`.md` files) and folders; any other file type
  // in the Bundle is ignored. Displayed names omit the `.md` extension.
  const displayName = $derived(node.isDir ? node.name : node.name.replace(/\.md$/i, ''));

  // Reserved files (`index.md`/`log.md`) are NOT shown as ordinary tree leaves;
  // they are surfaced as per-folder affordances on the containing folder row
  // instead. Strip them — and any non-markdown file — from the normal child
  // listing here (slice: reserved-files).
  const ordinaryChildren = $derived(
    (node.children ?? []).filter(
      (c) => c.isDir || (c.name.toLowerCase().endsWith('.md') && !isReservedFile(c.path)),
    ),
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
  <div class="row dir" data-row-path={node.path} style="padding-left: {indent}px" oncontextmenu={openMenu} role="treeitem" aria-selected="false" tabindex="-1">
    <!-- The disclosure twisty and the folder name are split into two toggle
         buttons so the reserved-file icons (index/log) can sit between them,
         directly in front of the label — matching the Explorer header. The
         twisty button is the accessible control (carries aria-expanded + the
         folder's accessible name); the name button is a redundant click target
         hidden from assistive tech to avoid a duplicate announcement. -->
    <button
      class="entry dir-toggle twisty-toggle"
      type="button"
      onclick={toggle}
      aria-expanded={expanded}
      aria-label={displayName}
    >
      <span class="twisty" class:open={expanded}>▸</span>
    </button>
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
      class="entry dir-toggle name-toggle"
      type="button"
      onclick={toggle}
      tabindex="-1"
      aria-hidden="true"
    >
      <span class="name">{displayName}</span>
    </button>
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
  <div class="row file" data-row-path={node.path} style="padding-left: {indent}px" oncontextmenu={openMenu} role="treeitem" aria-selected={selected === node.path} tabindex="-1">
    <button
      class="entry file-entry"
      class:selected={selected === node.path}
      class:nonmd={!isMarkdown}
      type="button"
      disabled={!isMarkdown}
      data-path={node.path}
      onclick={() => isMarkdown && onopen(node.path)}
    >
      <span class="name">{displayName}</span>
    </button>
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

  /* Folder rows highlight as a whole (the twisty/name halves are transparent),
     so the split toggle still reads as one row. */
  .row.dir:hover {
    background: var(--hover);
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
    border-radius: var(--radius-sm);
    opacity: 0.55;
    transition: background 0.12s ease;
  }

  .reserved-btn:hover {
    background: var(--hover);
    opacity: 1;
  }

  .reserved-btn.selected {
    opacity: 1;
    background: var(--accent-soft);
    color: var(--tag-text);
  }

  .reserved-btn:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: -1px;
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
    border-radius: var(--radius-sm);
    transition: background 0.12s ease;
  }

  .entry:hover:not(:disabled) {
    background: var(--hover);
  }

  /* Split folder toggle: twisty on the left, name takes the rest. Kept
     transparent — the row owns the hover highlight (see `.row.dir:hover`). */
  .twisty-toggle {
    flex: 0 0 auto;
    gap: 0;
    padding-right: 0;
  }

  .twisty-toggle:hover {
    background: none;
  }

  .name-toggle {
    padding-left: 0.25rem;
  }

  .name-toggle:hover {
    background: none;
  }

  .entry:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: -1px;
  }

  .file-entry.selected {
    background: var(--accent-soft);
    color: var(--tag-text);
  }

  .file-entry.nonmd {
    cursor: default;
    opacity: 0.5;
  }

  .twisty {
    display: inline-block;
    width: 1em;
    transition: transform 0.1s ease;
    color: var(--text-muted);
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
