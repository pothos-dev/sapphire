<script lang="ts">
  // Backlinks panel (slice 7).
  //
  // Lists the Concepts whose body links TO the currently-focused Concept, via
  // the index's reverse map (`backend.backlinks`). Each entry is clickable and
  // opens the source Concept through `onopen` (the editor store's navigation,
  // so it participates in back/forward history).
  //
  // Refresh: the list is recomputed whenever the focused Concept (`path`) OR the
  // index changes. We thread the index's monotonically increasing `version`
  // (bumped on every `file-changed` refresh — the same signal the broken-link
  // cache uses) in as a reactive dependency, so the panel re-queries when links
  // change on disk without inventing a new refresh mechanism.

  import { backend } from '$lib/ipc';
  import { stripMd } from '$lib/path';

  interface Props {
    /** bundle-relative path of the focused Concept, or null when none open. */
    path: string | null;
    /** Index version signal; re-query when it bumps (file-changed). */
    version: number;
    /** Open a source Concept (routes through navigation/history). */
    onopen: (path: string) => void;
  }

  let { path, version, onopen }: Props = $props();

  let sources = $state<string[]>([]);

  // Re-query whenever the focused Concept or the index version changes. Reading
  // both inside the effect registers them as reactive dependencies.
  $effect(() => {
    const current = path;
    void version; // dependency: re-run when the index refreshes
    if (current === null) {
      sources = [];
      return;
    }
    let cancelled = false;
    void backend.backlinks(current).then((result) => {
      if (!cancelled) sources = result;
    });
    return () => {
      cancelled = true;
    };
  });

  /** Canonical Concept name: the bundle-relative path without the `.md`
   *  extension (e.g. `concepts/index.md` → `concepts/index`). */
  function canonical(p: string): string {
    return stripMd(p);
  }
</script>

<section class="backlinks" aria-label="Backlinks" data-testid="backlinks">
  {#if path === null}
    <p class="empty" data-testid="backlinks-empty">No Concept open.</p>
  {:else if sources.length === 0}
    <p class="empty" data-testid="backlinks-empty">No backlinks</p>
  {:else}
    <ul class="list">
      {#each sources as source (source)}
        <li>
          <button
            type="button"
            class="entry"
            data-testid="backlink"
            data-path={source}
            title={source}
            onclick={() => onopen(source)}
          >
            <span class="name">{canonical(source)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .backlinks {
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
    font-style: italic;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .entry {
    display: block;
    width: 100%;
    padding: 0.25rem 0.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 0.12s ease;
  }

  .entry:hover {
    background: var(--hover);
  }

  .entry:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: -2px;
  }

  .name {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
