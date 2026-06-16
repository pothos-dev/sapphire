<script lang="ts">
  import type { TreeNode } from '$lib/types';
  import Self from './Tree.svelte';

  interface Props {
    node: TreeNode;
    /** path of the currently-open Concept, for highlighting */
    selected: string | null;
    /** called when a `.md` file is clicked */
    onopen: (path: string) => void;
    /** depth for indentation (root's children start at 0) */
    depth?: number;
  }

  let { node, selected, onopen, depth = 0 }: Props = $props();

  // Directories are expanded by default near the top, collapsed deeper.
  // `depth` is a fixed prop per node instance; only its initial value matters.
  // svelte-ignore state_referenced_locally
  let expanded = $state(depth < 2);

  const indent = $derived(depth * 12);

  function toggle() {
    expanded = !expanded;
  }

  const isMarkdown = $derived(!node.isDir && node.name.toLowerCase().endsWith('.md'));
</script>

{#if node.isDir}
  <div class="row dir" style="padding-left: {indent}px">
    <button class="entry dir-toggle" type="button" onclick={toggle} aria-expanded={expanded}>
      <span class="twisty" class:open={expanded}>▸</span>
      <span class="name">{node.name}</span>
    </button>
  </div>
  {#if expanded && node.children}
    <ul class="children">
      {#each node.children as child (child.path)}
        <li>
          <Self node={child} {selected} {onopen} depth={depth + 1} />
        </li>
      {/each}
    </ul>
  {/if}
{:else}
  <div class="row file" style="padding-left: {indent}px">
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
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
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
