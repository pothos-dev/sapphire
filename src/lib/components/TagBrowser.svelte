<script lang="ts">
  // Tag browser (slice 8).
  //
  // Lists all tags across the Bundle with per-tag counts (`backend.allTags`).
  // Selecting a tag reveals the Concepts carrying it (`backend.conceptsByTag`,
  // an index query — no frontend scan); selecting a Concept opens it through
  // `onopen` (navigation/history).
  //
  // Refresh: like the backlinks panel, we thread the index `version` signal
  // (bumped on every `file-changed` refresh) as a reactive dependency, so the
  // tag list — and the expanded tag's Concept list — re-query when frontmatter
  // tags change on disk, without a bespoke refresh mechanism.

  import { backend } from '$lib/ipc';
  import type { TagCount } from '$lib/types';

  interface Props {
    /** Index version signal; re-query when it bumps (file-changed). */
    version: number;
    /** path of the currently-open Concept, for highlighting. */
    selected: string | null;
    /** Open a Concept (routes through navigation/history). */
    onopen: (path: string) => void;
  }

  let { version, selected, onopen }: Props = $props();

  let tags = $state<TagCount[]>([]);
  /** The expanded tag, or null when none is selected. */
  let activeTag = $state<string | null>(null);
  /** Concepts carrying the active tag. */
  let concepts = $state<string[]>([]);

  // Load all tags whenever the index version changes.
  $effect(() => {
    void version;
    let cancelled = false;
    void backend.allTags().then((result) => {
      if (cancelled) return;
      tags = result;
      // Drop the active tag if it no longer exists (e.g. last Concept untagged).
      if (activeTag !== null && !result.some((t) => t.tag === activeTag)) {
        activeTag = null;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  // Load the Concepts for the active tag, re-querying on version changes too.
  $effect(() => {
    const tag = activeTag;
    void version;
    if (tag === null) {
      concepts = [];
      return;
    }
    let cancelled = false;
    void backend.conceptsByTag(tag).then((result) => {
      if (!cancelled) concepts = result;
    });
    return () => {
      cancelled = true;
    };
  });

  function toggleTag(tag: string) {
    activeTag = activeTag === tag ? null : tag;
  }

  /** Filename of a bundle-relative path, for a compact label. */
  function label(p: string): string {
    const slash = p.lastIndexOf('/');
    return slash === -1 ? p : p.slice(slash + 1);
  }
</script>

<section class="tag-browser" aria-label="Tags" data-testid="tag-browser">
  {#if tags.length === 0}
    <p class="empty" data-testid="tags-empty">No tags</p>
  {:else}
    <ul class="tag-list">
      {#each tags as { tag, count } (tag)}
        <li>
          <button
            type="button"
            class="tag"
            class:active={activeTag === tag}
            data-testid="tag"
            data-tag={tag}
            aria-expanded={activeTag === tag}
            onclick={() => toggleTag(tag)}
          >
            <span class="tag-name">{tag}</span>
            <span class="count" data-testid="tag-count">{count}</span>
          </button>

          {#if activeTag === tag}
            <ul class="concept-list" data-testid="tag-concepts">
              {#each concepts as path (path)}
                <li>
                  <button
                    type="button"
                    class="concept"
                    class:selected={selected === path}
                    data-testid="tag-concept"
                    data-path={path}
                    title={path}
                    onclick={() => onopen(path)}
                  >
                    {label(path)}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .tag-browser {
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
  }

  .empty {
    margin: 0;
    color: #888;
    font-style: italic;
  }

  .tag-list,
  .concept-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tag {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.25rem 0.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
  }

  .tag:hover {
    background: rgba(127, 127, 127, 0.15);
  }

  .tag.active {
    background: rgba(46, 204, 113, 0.18);
  }

  .tag-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: 0 0 auto;
    min-width: 1.2rem;
    padding: 0 0.35rem;
    border-radius: 0.6rem;
    background: rgba(127, 127, 127, 0.2);
    color: #888;
    font-size: 0.72rem;
    text-align: center;
  }

  .concept-list {
    margin: 0.1rem 0 0.3rem;
    padding-left: 0.6rem;
    border-left: 2px solid rgba(127, 127, 127, 0.2);
  }

  .concept {
    width: 100%;
    padding: 0.2rem 0.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .concept:hover {
    background: rgba(127, 127, 127, 0.15);
  }

  .concept.selected {
    background: rgba(80, 140, 255, 0.25);
  }
</style>
