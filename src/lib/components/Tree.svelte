<script lang="ts">
  import type { TreeNode } from '$lib/types';
  import { dirname } from '$lib/path';
  import { session } from '$lib/state/session.svelte';
  import { treeActions } from '$lib/state/treeActions.svelte';
  import { treeDnd } from '$lib/state/treeDnd.svelte';
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

  // Drag-and-drop moving (slice: tree-dnd). Folders and Concepts (`.md` files)
  // can be dragged. The drop TARGET resolves to a folder: a folder row means
  // "move INTO this folder"; a file row resolves to its PARENT folder, so a
  // slightly-off drop onto a sibling Concept is a safe no-op rather than a
  // surprise move. Dropping onto empty tree space targets the Bundle root — that
  // zone lives on `.tree-pane` in App.svelte.
  const draggable = $derived(node.isDir || isMarkdown);
  const dropDir = $derived(node.isDir ? node.path : dirname(node.path));
  // Only folder rows show the highlight; a hovered file lights up its PARENT.
  const isDropTarget = $derived(node.isDir && treeDnd.dropTarget === node.path);

  function onDragStart(e: DragEvent) {
    if (!draggable) return;
    treeDnd.start(node.path);
    // Firefox only initiates a drag once `setData` is called; the path also
    // rides along as a courtesy for anything reading the dropped payload.
    e.dataTransfer?.setData('text/plain', node.path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  // Hovering a collapsed folder mid-drag springs it open after a beat, so a
  // Concept can be dropped into a nested folder without a separate expand click.
  let expandTimer: ReturnType<typeof setTimeout> | null = null;
  function clearExpandTimer() {
    if (expandTimer !== null) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
  }

  function onDragOver(e: DragEvent) {
    const from = treeDnd.dragging;
    if (from === null || !treeDnd.canDrop(from, dropDir)) return;
    e.preventDefault(); // a missing preventDefault here means "not a drop target"
    e.stopPropagation(); // handled here — don't also trigger the root drop zone
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    treeDnd.dropTarget = dropDir;
    if (node.isDir && !expanded && expandTimer === null) {
      expandTimer = setTimeout(() => session.setExpanded(node.path, true), 600);
    }
  }

  function onDragLeave(e: DragEvent) {
    // Ignore leaves into our own descendants; only clear when the pointer
    // actually exits this row.
    if (e.currentTarget instanceof Node && e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) {
      return;
    }
    clearExpandTimer();
    if (treeDnd.dropTarget === dropDir) treeDnd.dropTarget = null;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    clearExpandTimer();
    const from = treeDnd.dragging;
    treeDnd.end();
    if (from !== null && treeDnd.canDrop(from, dropDir)) void treeActions.movePath(from, dropDir);
  }

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
  <div
    class="row dir"
    class:drop-target={isDropTarget}
    data-row-path={node.path}
    style="padding-left: {indent}px"
    oncontextmenu={openMenu}
    {draggable}
    ondragstart={onDragStart}
    ondragend={() => treeDnd.end()}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    role="treeitem"
    aria-selected="false"
    tabindex="-1"
  >
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
  <div
    class="row file"
    data-row-path={node.path}
    style="padding-left: {indent}px"
    oncontextmenu={openMenu}
    draggable={isMarkdown}
    ondragstart={onDragStart}
    ondragend={() => treeDnd.end()}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    role="treeitem"
    aria-selected={selected === node.path}
    tabindex="-1"
  >
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

  /* The folder under the dragged Concept while a move is in flight. */
  .row.dir.drop-target {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-ring);
    border-radius: var(--radius-sm);
  }

  /* The dragged row dims so it reads as "in transit". */
  .row[draggable='true']:active {
    cursor: grabbing;
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
