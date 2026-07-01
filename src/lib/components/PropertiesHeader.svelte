<script lang="ts">
  // Panel header for the Properties panel: a collapse toggle (left) + unified
  // undo/redo over the single body+frontmatter history (right). Purely
  // presentational — it owns no state and reaches for no store; the parent
  // supplies the effective shown state, count, availability, and the callbacks.
  //
  // The history buttons mousedown-prevent default so clicking them does not blur
  // (and thus commit) an in-progress scalar/key edit before the command runs.
  // The toggle does NOT — clicking it should blur/commit any active edit before
  // the body is hidden.

  interface Props {
    /** Effective shown state (drives chevron rotation + `aria-expanded`). */
    bodyShown: boolean;
    /** Number of properties, for the collapsed-only count badge. */
    count: number;
    canUndo: boolean;
    canRedo: boolean;
    onToggle: () => void;
    onUndo: () => void;
    onRedo: () => void;
  }

  let { bodyShown, count, canUndo, canRedo, onToggle, onUndo, onRedo }: Props = $props();
</script>

<div class="panel-header" data-testid="properties-header">
  <button
    type="button"
    class="panel-toggle"
    aria-expanded={bodyShown}
    aria-label="Properties"
    data-testid="properties-toggle"
    onclick={onToggle}
  >
    <span class="chevron" class:open={bodyShown} aria-hidden="true">▸</span>
    <span class="panel-title">Properties</span>
    {#if !bodyShown && count > 0}
      <span class="panel-count" data-testid="properties-count">{count}</span>
    {/if}
  </button>
  <div class="history">
    <button
      type="button"
      class="hist-btn"
      data-testid="undo"
      title="Undo (Ctrl+Z)"
      aria-label="Undo"
      disabled={!canUndo}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => onUndo()}>↶</button
    >
    <button
      type="button"
      class="hist-btn"
      data-testid="redo"
      title="Redo (Ctrl+Shift+Z)"
      aria-label="Redo"
      disabled={!canRedo}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => onRedo()}>↷</button
    >
  </div>
</div>

<style>
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* Collapse toggle: chevron + "Properties" label, styled like the sidebar
     section headers for consistency. Rotating chevron mirrors `aria-expanded`. */
  .panel-toggle {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    border: none;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 0.15rem 0.25rem;
    border-radius: var(--radius-sm);
    transition: color 0.12s ease;
  }

  .panel-toggle:hover {
    color: var(--text);
  }

  .panel-toggle:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .chevron {
    display: inline-block;
    font-size: 0.7rem;
    transition: transform 0.12s ease;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  /* Count badge shown beside the title only while collapsed, so the user can see
     a collapsed panel still holds properties. */
  .panel-count {
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    opacity: 0.8;
    text-transform: none;
    letter-spacing: 0;
  }

  .history {
    display: flex;
    gap: 0.2rem;
  }

  .hist-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  .hist-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }

  .hist-btn:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .hist-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
