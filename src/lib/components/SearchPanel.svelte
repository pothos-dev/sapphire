<script lang="ts">
  /**
   * Full-text search panel (slice: full-text-search).
   *
   * A centered overlay bound to Ctrl+Shift+F (the parent owns the keybinding and
   * toggles `open`). Typing a query is DEBOUNCED, then sent to `backend.search`,
   * which scans every Concept body in the Bundle on demand. Results list the
   * matching Concept path, line number, and the matching line (with the matched
   * substring highlighted). Selecting a result opens that Concept THROUGH the
   * navigation/history path and scrolls the editor to the matching line.
   * ↑/↓ move the selection, Enter opens the highlighted result, Escape closes.
   *
   * Style mirrors the QuickNav palette for consistency.
   */
  import { backend } from '$lib/ipc';
  import type { SearchHit } from '$lib/types';

  interface Props {
    /** Whether the panel is open. */
    open: boolean;
    /** Open the chosen Concept at `line` (routes through editor navigation). */
    onopen: (path: string, line: number) => void;
    /** Close the panel. */
    onclose: () => void;
  }

  let { open, onopen, onclose }: Props = $props();

  /** Debounce: search this long after the user stops typing. */
  const SEARCH_DEBOUNCE_MS = 200;

  let query = $state('');
  let results = $state<SearchHit[]>([]);
  let selected = $state(0);
  let searching = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Monotonic token so a slow earlier search cannot overwrite a newer one.
  let queryToken = 0;

  const activeIndex = $derived(
    results.length === 0 ? 0 : Math.min(selected, results.length - 1),
  );

  // Reset + focus each time the panel transitions to open. Tracks `open` only.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true;
      query = '';
      results = [];
      selected = 0;
      searching = false;
      queueMicrotask(() => input?.focus());
    } else if (!open) {
      wasOpen = false;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }
  });

  function runSearch(q: string) {
    const trimmed = q.trim();
    if (trimmed === '') {
      results = [];
      searching = false;
      return;
    }
    const token = ++queryToken;
    searching = true;
    void backend.search(trimmed).then((hits) => {
      if (token !== queryToken) return; // a newer query superseded this one
      results = hits;
      selected = 0;
      searching = false;
    });
  }

  function onInput() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    const q = query;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runSearch(q);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Split a path into [dir, basename] for display. */
  function splitPath(path: string): { dir: string; base: string } {
    const slash = path.lastIndexOf('/');
    if (slash === -1) return { dir: '', base: path };
    return { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
  }

  /** Split a snippet around the (case-insensitive) match for highlighting. */
  function highlightParts(snippet: string): { text: string; match: boolean }[] {
    const q = query.trim();
    if (q === '') return [{ text: snippet, match: false }];
    const lower = snippet.toLowerCase();
    const needle = q.toLowerCase();
    const parts: { text: string; match: boolean }[] = [];
    let i = 0;
    let found = lower.indexOf(needle, i);
    while (found !== -1) {
      if (found > i) parts.push({ text: snippet.slice(i, found), match: false });
      parts.push({ text: snippet.slice(found, found + needle.length), match: true });
      i = found + needle.length;
      found = lower.indexOf(needle, i);
    }
    if (i < snippet.length) parts.push({ text: snippet.slice(i), match: false });
    return parts;
  }

  function choose(hit: SearchHit) {
    onopen(hit.path, hit.line);
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
      if (r) choose(r);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

{#if open}
  <!-- Backdrop: an outside click closes the panel. -->
  <div class="fts-backdrop" role="presentation" onclick={onclose}></div>

  <div class="fts-panel" role="dialog" aria-modal="true" data-testid="search-panel">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={input}
      bind:value={query}
      class="fts-input"
      type="text"
      placeholder="Search Concept contents…"
      aria-label="Full-text search"
      data-testid="search-input"
      autocomplete="off"
      autofocus
      oninput={onInput}
      onkeydown={onKeydown}
    />

    {#if query.trim() !== ''}
      <p class="fts-hint" data-testid="search-status">
        {searching ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`}
      </p>
    {/if}

    <ul class="fts-results" role="listbox" data-testid="search-results">
      {#each results as r, i (`${r.path}:${r.line}`)}
        {@const sp = splitPath(r.path)}
        <li role="option" aria-selected={i === activeIndex}>
          <button
            type="button"
            class="fts-item"
            class:selected={i === activeIndex}
            data-path={r.path}
            data-line={r.line}
            data-testid="search-item"
            onmousemove={() => (selected = i)}
            onclick={() => choose(r)}
          >
            <span class="fts-loc">
              <span class="fts-base">{sp.base}</span>
              {#if sp.dir}<span class="fts-dir">{sp.dir}</span>{/if}
              <span class="fts-line">:{r.line}</span>
            </span>
            <span class="fts-snippet" data-testid="search-snippet">
              {#each highlightParts(r.snippet) as part}
                {#if part.match}<mark class="fts-mark">{part.text}</mark>{:else}{part.text}{/if}
              {/each}
            </span>
          </button>
        </li>
      {:else}
        {#if query.trim() !== '' && !searching}
          <li class="fts-empty" data-testid="search-empty">No matches</li>
        {/if}
      {/each}
    </ul>
  </div>
{/if}

<style>
  .fts-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    background: rgba(0, 0, 0, 0.25);
  }

  .fts-panel {
    position: fixed;
    z-index: 1201;
    top: 12%;
    left: 50%;
    transform: translateX(-50%);
    width: min(640px, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: 0.5rem;
    border-radius: 10px;
    background: #ffffff;
    color: #0f0f0f;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
  }

  :global(.app[data-theme='dark']) .fts-panel {
    background: #2a2a2a;
    color: #e6e6e6;
  }

  .fts-input {
    box-sizing: border-box;
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 1rem;
  }

  .fts-hint {
    margin: 0.5rem 0.2rem 0.1rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
  }

  .fts-results {
    list-style: none;
    margin: 0.35rem 0 0;
    padding: 0;
    overflow: auto;
  }

  .fts-item {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 100%;
    padding: 0.4rem 0.55rem;
    border: none;
    border-radius: 5px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .fts-item:hover,
  .fts-item.selected {
    background: rgba(80, 140, 255, 0.22);
  }

  .fts-loc {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }

  .fts-base {
    font-weight: 500;
  }

  .fts-dir {
    font-size: 0.78rem;
    color: #888;
  }

  .fts-line {
    font-size: 0.74rem;
    color: #888;
  }

  .fts-snippet {
    font-size: 0.82rem;
    color: #555;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  :global(.app[data-theme='dark']) .fts-snippet {
    color: #bbb;
  }

  .fts-mark {
    background: rgba(255, 213, 0, 0.55);
    color: inherit;
    border-radius: 2px;
  }

  :global(.app[data-theme='dark']) .fts-mark {
    background: rgba(255, 213, 0, 0.35);
  }

  .fts-empty {
    padding: 0.5rem 0.55rem;
    color: #888;
    font-size: 0.85rem;
  }
</style>
