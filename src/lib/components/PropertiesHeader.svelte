<script lang="ts">
  // Panel header for the Properties panel: just a collapse toggle. Purely
  // presentational — it owns no state and reaches for no store; the parent
  // supplies the effective shown state, count, and the toggle callback.
  //
  // Undo/redo used to ride here by historical accident; they are per-Pane
  // controls and moved to the PaneHeader (slice: per-tile-header). Clicking the
  // toggle blurs/commits any active edit before the body is hidden.

  interface Props {
    /** Effective shown state (drives chevron rotation + `aria-expanded`). */
    bodyShown: boolean;
    /** Number of properties, for the collapsed-only count badge. */
    count: number;
    onToggle: () => void;
  }

  let { bodyShown, count, onToggle }: Props = $props();
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
</style>
