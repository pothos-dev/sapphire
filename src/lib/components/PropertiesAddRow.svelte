<script lang="ts">
  // Add controls. Create a new scalar (`Text`) or flat-list (`List`) property.
  // The kind is fixed at creation; new rows append after existing ones. The two
  // add buttons ARE the grid's final ("add-controls") row: they carry the
  // `data-cell-row`/`data-cell-col` coordinates (row = `addRowIndex`, one past
  // the last data row) and the roving tabindex, so ↓ from the last row lands here
  // and ←/→ move between them. `.cell-active` mirrors the cells' nav-mode
  // spotlight (programmatic focus doesn't reliably set `:focus-visible`).
  // Clicking still adds regardless of focus. On a frontmatter-less Concept these
  // are the only body content — expanding the panel surfaces them directly; the
  // `---…---` block is materialized on disk only once the first property is
  // committed.
  //
  // Purely presentational: the parent owns the grid cursor and passes the
  // per-button focus (roving tabindex) and active (spotlight ring) flags
  // separately — they DIFFER (tabindex ignores whether the Region is active).

  import { KEY_COL, VALUE_COL } from '$lib/state/propertiesNav.svelte';

  interface Props {
    /** Grid row index of the add-controls row (`properties.length`). */
    addRowIndex: number;
    /** `+ Text` is the Focused cell (roving tabindex). */
    textFocused: boolean;
    /** `+ Text` shows the nav-mode spotlight ring (Focused AND Region active). */
    textActive: boolean;
    /** `+ List` is the Focused cell (roving tabindex). */
    listFocused: boolean;
    /** `+ List` shows the nav-mode spotlight ring (Focused AND Region active). */
    listActive: boolean;
    onAddText: () => void;
    onAddList: () => void;
  }

  let {
    addRowIndex,
    textFocused,
    textActive,
    listFocused,
    listActive,
    onAddText,
    onAddList,
  }: Props = $props();
</script>

<div class="add" data-testid="properties-add">
  <button
    type="button"
    class="add-btn"
    class:cell-active={textActive}
    data-testid="add-text"
    data-cell-row={addRowIndex}
    data-cell-col={KEY_COL}
    tabindex={textFocused ? 0 : -1}
    onclick={onAddText}
  >
    + Text
  </button>
  <button
    type="button"
    class="add-btn"
    class:cell-active={listActive}
    data-testid="add-list"
    data-cell-row={addRowIndex}
    data-cell-col={VALUE_COL}
    tabindex={listFocused ? 0 : -1}
    onclick={onAddList}
  >
    + List
  </button>
</div>

<style>
  .add {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.15rem;
  }

  .add-btn {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.55rem;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      color 0.15s ease,
      background-color 0.15s ease;
  }

  .add-btn:hover {
    color: var(--text);
    border-color: var(--accent);
    background: var(--hover);
  }

  .add-btn:focus-visible,
  .add-btn.cell-active {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
