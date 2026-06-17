<script lang="ts">
  /**
   * Quick-nav palette (slice: quick-nav-palette).
   *
   * A centered command palette bound to Ctrl+K (the parent owns the keybinding
   * and toggles `open`). Typing fuzzy-matches bundle-relative Concept paths;
   * with empty input it shows the per-Bundle recent files (most-recent first).
   * ↑/↓ move the selection, Enter opens the highlighted Concept THROUGH the
   * navigation/history path (so back/forward keeps working), Escape closes.
   */
  import { fuzzyRank, type FuzzyMatch } from '$lib/fuzzy';
  import { splitPath } from '$lib/path';
  import { isReservedFile } from '$lib/reserved';

  interface Props {
    /** Whether the palette is open. */
    open: boolean;
    /** All bundle-relative Concept paths to match against. */
    paths: string[];
    /** Recent files (most-recent first), shown when the input is empty. */
    recent: string[];
    /** Open the chosen Concept (routes through editor navigation/history). */
    onopen: (path: string) => void;
    /** Close the palette. */
    onclose: () => void;
  }

  let { open, paths, recent, onopen, onclose }: Props = $props();

  let query = $state('');
  let selected = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLUListElement | null>(null);

  // Results: ranked fuzzy matches while typing, else the recent-files list (kept
  // only to existing Concept paths so a deleted file never lingers in the list).
  type Result = { path: string; positions: number[] };
  const results = $derived.by<Result[]>(() => {
    const q = query.trim();
    if (q === '') {
      const known = new Set(paths);
      return recent.filter((p) => known.has(p)).map((p) => ({ path: p, positions: [] }));
    }
    return fuzzyRank(q, paths).map((m: FuzzyMatch) => ({
      path: m.target,
      positions: m.positions,
    }));
  });

  // The effective selection, clamped to the current result set without writing
  // back to state (avoids an effect-update loop). `selected` is the user's
  // intent; this derived value is what the UI highlights / Enter opens.
  const activeIndex = $derived(
    results.length === 0 ? 0 : Math.min(selected, results.length - 1),
  );

  // Keep the highlighted result within the scrollable viewport as the selection
  // moves with ↑/↓ (and wraps at the ends), matching the Search panel.
  $effect(() => {
    // Track activeIndex (and results, so it re-runs after the list changes).
    void activeIndex;
    void results;
    const el = list?.querySelector<HTMLElement>('.qn-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  });

  // Reset + focus each time the palette transitions to open. Tracks `open` only
  // (NOT query/selected) so it doesn't re-run on every keystroke.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true;
      query = '';
      selected = 0;
      queueMicrotask(() => input?.focus());
    } else if (!open) {
      wasOpen = false;
    }
  });

  /** Split a path into [prefix, basename] for display. */

  function choose(path: string) {
    onopen(path);
    onclose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) selected = (activeIndex + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) selected = (activeIndex - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIndex];
      if (r) choose(r.path);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

{#if open}
  <!-- Backdrop: an outside click closes the palette. -->
  <div class="qn-backdrop" role="presentation" onclick={onclose}></div>

  <div class="qn-panel" role="dialog" aria-modal="true" data-testid="quick-nav">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={input}
      bind:value={query}
      class="qn-input"
      type="text"
      placeholder="Jump to a Concept…"
      aria-label="Quick navigation"
      data-testid="quick-nav-input"
      autocomplete="off"
      autofocus
      onkeydown={onKeydown}
    />

    {#if query.trim() === ''}
      <p class="qn-hint" data-testid="quick-nav-hint">Recent files</p>
    {/if}

    <ul bind:this={list} class="qn-results" role="listbox" data-testid="quick-nav-results">
      {#each results as r, i (r.path)}
        {@const sp = splitPath(r.path)}
        <li role="option" aria-selected={i === activeIndex}>
          <button
            type="button"
            class="qn-item"
            class:selected={i === activeIndex}
            data-path={r.path}
            data-testid="quick-nav-item"
            onmousemove={() => (selected = i)}
            onclick={() => choose(r.path)}
          >
            <span class="qn-base">{sp.base}</span>
            {#if sp.dir}<span class="qn-dir">{sp.dir}</span>{/if}
            {#if isReservedFile(r.path)}<span class="qn-badge">reserved</span>{/if}
          </button>
        </li>
      {:else}
        <li class="qn-empty" data-testid="quick-nav-empty">No matches</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .qn-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    background: rgba(16, 22, 18, 0.4);
  }

  .qn-panel {
    position: fixed;
    z-index: 1201;
    top: 18%;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, 90vw);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    padding: 0.5rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: var(--shadow-lg);
    font-family: var(--font-ui);
  }

  .qn-input {
    box-sizing: border-box;
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }

  .qn-input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .qn-hint {
    margin: 0.5rem 0.2rem 0.1rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
  }

  .qn-results {
    list-style: none;
    margin: 0.35rem 0 0;
    padding: 0;
    overflow: auto;
  }

  .qn-item {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    padding: 0.4rem 0.55rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .qn-item:hover {
    background: var(--hover);
  }

  .qn-item.selected {
    background: var(--accent-soft);
    color: var(--tag-text);
  }

  .qn-base {
    font-weight: 500;
  }

  .qn-dir {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-faint);
  }

  .qn-badge {
    margin-left: auto;
    font-size: 0.68rem;
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    background: var(--tag-bg);
    color: var(--tag-text);
  }

  .qn-empty {
    padding: 0.5rem 0.55rem;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
</style>
