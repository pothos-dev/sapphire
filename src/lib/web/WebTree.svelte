<script lang="ts">
  import type { TreeNode } from '$lib/types';
  import { stripMd } from '$lib/path';
  import Self from './WebTree.svelte';

  interface Props {
    node: TreeNode;
    /** path of the currently-open Concept (for the "open" marker) */
    selected: string | null;
    /** called when a `.md` Concept is clicked */
    onopen: (path: string) => void;
    /** indentation depth (root's children start at 0) */
    depth?: number;
  }

  let { node, selected, onopen, depth = 0 }: Props = $props();

  // A deliberately minimal, READ-ONLY Explorer tree for the web skeleton: no
  // create/rename/delete/move affordances, no drag-and-drop, no keyboard nav —
  // just folders and Concepts. Everything renders server-side (SSR) so the tree
  // is present in the initial HTML, then hydrates for click-to-open. Folders are
  // shown always-expanded so the whole Bundle is visible without client state.
  const isMarkdown = $derived(!node.isDir && node.name.toLowerCase().endsWith('.md'));
  const displayName = $derived(node.isDir ? node.name : stripMd(node.name));
  const indent = $derived(depth * 14);
  // Only Concepts (`.md`) and folders show; other file types are ignored.
  const children = $derived(
    node.isDir ? (node.children ?? []).filter((c) => c.isDir || c.name.toLowerCase().endsWith('.md')) : [],
  );
</script>

{#if node.isDir}
  <div class="row dir" style="padding-left: {indent}px" data-testid="tree-dir" data-path={node.path}>
    <span class="glyph" aria-hidden="true">📁</span>
    <span class="name">{displayName}</span>
  </div>
  <ul class="children">
    {#each children as child (child.path)}
      <li><Self node={child} {selected} {onopen} depth={depth + 1} /></li>
    {/each}
  </ul>
{:else if isMarkdown}
  <button
    type="button"
    class="row file"
    class:selected={selected === node.path}
    style="padding-left: {indent}px"
    data-testid="tree-concept"
    data-path={node.path}
    onclick={() => onopen(node.path)}
  >
    <span class="glyph" aria-hidden="true">📄</span>
    <span class="name">{displayName}</span>
  </button>
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
    gap: 0.35rem;
    width: 100%;
    padding-block: 0.15rem;
    padding-right: 0.4rem;
    border-radius: var(--radius-sm, 4px);
    font: inherit;
    color: inherit;
    text-align: left;
  }

  .row.file {
    border: none;
    background: none;
    cursor: pointer;
  }

  .row.file:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .row.file.selected {
    background: var(--accent-soft, rgba(80, 120, 255, 0.2));
    color: var(--tag-text, inherit);
  }

  .row.dir .name {
    font-weight: 600;
  }

  .glyph {
    flex: 0 0 auto;
    font-size: 0.8rem;
    line-height: 1;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
