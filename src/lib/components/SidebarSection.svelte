<script lang="ts">
  // VSCode-style collapsible sidebar section (an "accordion" pane).
  //
  // The header is always visible and toggles the body. When expanded the body
  // sizes to its natural content height but is capped so the expanded sections
  // share the viewport: the cap is `viewport / number-of-expanded-sections`
  // (≈1/3 each when all three are open, 1/2 when one is collapsed, full when two
  // are). The expanded count is supplied by the parent as the `--expanded-count`
  // CSS custom property on the sidebar container, so the cap is pure CSS and
  // updates reactively as sections open/close. `flex-shrink` + `min-height: 0`
  // guarantee everything fits the viewport even if header heights drift from the
  // 2rem assumed by the cap formula; overflow scrolls within each body.
  import type { Snippet } from 'svelte';

  interface Props {
    /** Section title shown in the always-visible header. */
    title: string;
    /** Whether the body is shown. Owned by the parent (drives the cap). */
    expanded: boolean;
    /** Toggle handler (the parent flips its own state). */
    ontoggle: () => void;
    /** Optional test id; the header/body get `${testid}-header`/`-body`. */
    testid?: string;
    /** Optional header actions, rendered beside the title (always visible, even
        when collapsed). Kept outside the toggle button so clicks don't toggle. */
    actions?: Snippet;
    /** Body content. */
    children: Snippet;
  }

  let { title, expanded, ontoggle, testid, actions, children }: Props = $props();
</script>

<section class="section" data-testid={testid} aria-label={title}>
  <div class="header">
    <button
      type="button"
      class="header-toggle"
      aria-expanded={expanded}
      data-testid={testid ? `${testid}-header` : undefined}
      onclick={ontoggle}
    >
      <span class="chevron" class:open={expanded} aria-hidden="true">▸</span>
      <span class="title">{title}</span>
    </button>
    {#if actions}
      <div class="header-actions">{@render actions()}</div>
    {/if}
  </div>
  {#if expanded}
    <div class="body" data-testid={testid ? `${testid}-body` : undefined}>
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    flex: 0 1 auto;
    min-height: 0;
    border-bottom: 1px solid var(--border);
  }

  .header {
    display: flex;
    align-items: center;
    flex: none;
    box-sizing: border-box;
    width: 100%;
    height: 2rem;
  }

  .header-toggle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: 100%;
    padding: 0 0.6rem;
    border: none;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .header-toggle:hover {
    background: var(--hover);
  }

  .header-toggle:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
  }

  .header-actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: 0.15rem;
    padding-right: 0.4rem;
  }

  .chevron {
    display: inline-block;
    font-size: 0.7rem;
    transition: transform 0.12s ease;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .body {
    flex: 0 1 auto;
    min-height: 0;
    overflow: auto;
    /* Cap each expanded body to its share of the viewport (minus the three
       2rem headers). `--expanded-count` is set by the sidebar container. */
    max-height: calc((100vh - 6rem) / var(--expanded-count, 3));
  }
</style>
