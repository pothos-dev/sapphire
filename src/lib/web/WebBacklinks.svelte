<script lang="ts">
  /**
   * Backlinks Section for the web viewer (slice: web-index-backed-sidebars).
   *
   * Lists the Concepts whose body links TO the open Concept, via the core index
   * reverse map (`backend.backlinks`). Selecting one navigates within the viewer.
   *
   * REUSES the shared read-only parts of the desktop `Backlinks`: the same
   * re-query-on-`version` effect, the `stripMd` helper, and the markup / test-ids
   * / styles. It drops the desktop `backlinksNav`/`focus` keyboard-nav Region
   * infra (editor-only), using plain clicks. Re-queries when `path` changes or
   * `version` bumps (bumped by the viewer on each live-reload change event).
   */
  import { backend } from '$lib/ipc';
  import { stripMd } from '$lib/path';

  interface Props {
    /** bundle-relative path of the open Concept, or null when none open. */
    path: string | null;
    /** Bumped on live-reload change events; re-query when it changes. */
    version: number;
    /** Open a source Concept (routes through the viewer's `?path=` nav). */
    onopen: (path: string) => void;
  }

  let { path, version, onopen }: Props = $props();

  let sources = $state<string[]>([]);

  // Re-query whenever the open Concept or the index version changes. Reading
  // both inside the effect registers them as reactive dependencies.
  $effect(() => {
    const current = path;
    void version;
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

  /** Canonical Concept name: the bundle-relative path without the `.md`. */
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
    color: var(--text-muted, #777);
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
    border-radius: var(--radius-sm, 4px);
    transition: background 0.12s ease;
  }

  .entry:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .entry:focus-visible {
    outline: 2px solid var(--accent-ring, #2d6cdf);
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
