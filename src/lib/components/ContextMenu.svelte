<script lang="ts">
  /**
   * A small floating context menu (slice: tree-crud). Positioned at (x, y),
   * renders a list of actions, and closes on outside-click / Escape / action.
   * Generic over the action id so the caller decides the items.
   */
  interface MenuItem {
    id: string;
    label: string;
    /** Visually separate from the previous item (e.g. before a destructive op). */
    separated?: boolean;
    danger?: boolean;
  }

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { x, y, items, onselect, onclose }: Props = $props();

  function choose(id: string) {
    onselect(id);
    onclose();
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Backdrop: an outside click closes the menu. -->
<div
  class="backdrop"
  role="presentation"
  onclick={onclose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onclose();
  }}
></div>

<div
  class="menu"
  role="menu"
  data-testid="context-menu"
  style="left: {x}px; top: {y}px"
>
  {#each items as item (item.id)}
    <button
      type="button"
      role="menuitem"
      class="item"
      class:separated={item.separated}
      class:danger={item.danger}
      data-action={item.id}
      onclick={() => choose(item.id)}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .menu {
    position: fixed;
    z-index: 1001;
    min-width: 160px;
    padding: 0.25rem;
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 6px;
    background: #ffffff;
    color: #0f0f0f;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    font-size: 0.85rem;
  }

  :global(.app[data-theme='dark']) .menu {
    background: #2a2a2a;
    color: #e6e6e6;
    border-color: rgba(127, 127, 127, 0.45);
  }

  .item {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
  }

  .item:hover {
    background: rgba(127, 127, 127, 0.15);
  }

  .item.separated {
    margin-top: 0.25rem;
    border-top: 1px solid rgba(127, 127, 127, 0.25);
    padding-top: 0.4rem;
  }

  .item.danger {
    color: #c0392b;
  }
</style>
