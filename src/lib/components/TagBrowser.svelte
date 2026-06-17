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
  import { basename, stripMd } from '$lib/path';
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

  /** Leaf name of a bundle-relative path, sans `.md` — the same compact label
   *  the Explorer tree shows for its Concept leaves (the full path is on hover). */
  function label(p: string): string {
    return stripMd(basename(p));
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
            <span class="twisty" class:open={activeTag === tag}>▸</span>
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
    font-family: var(--font-ui);
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
    font-style: italic;
  }

  .tag-list,
  .concept-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* A tag is a collapsible root, styled like an Explorer folder row: a
     disclosure twisty, the tag name, then a trailing count. Expanding reveals
     the tagged Concepts as nested leaves (mirroring the tree's children). */
  .tag {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.15rem 0.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 0.12s ease;
  }

  .tag:hover {
    background: var(--hover);
  }

  .tag:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: -1px;
  }

  .twisty {
    flex: 0 0 auto;
    display: inline-block;
    width: 1em;
    transition: transform 0.1s ease;
    color: var(--text-muted);
  }

  .twisty.open {
    transform: rotate(90deg);
  }

  .tag-name {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: 0 0 auto;
    color: var(--text-faint);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .concept-list {
    margin: 0.05rem 0 0.15rem;
    padding-left: 0.6rem;
    margin-left: 0.5rem;
    border-left: 1px solid var(--border);
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
    border-radius: var(--radius-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 0.12s ease;
  }

  .concept:hover {
    background: var(--hover);
  }

  .concept:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: 1px;
  }

  .concept.selected {
    background: var(--accent-soft);
    color: var(--tag-text);
  }
</style>
