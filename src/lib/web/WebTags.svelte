<script lang="ts">
  /**
   * Tags Section for the web viewer (slice: web-index-backed-sidebars).
   *
   * Lists all bundle tags with per-tag counts (`backend.allTags`); expanding a
   * tag reveals the Concepts carrying it (`backend.conceptsByTag`, an index
   * query — no scan). Selecting a Concept navigates within the viewer. The whole
   * Section (header included) is HIDDEN when the Bundle carries no tags, as on
   * desktop.
   *
   * REUSES the shared read-only parts of the desktop `TagBrowser`: the same
   * allTags/conceptsByTag fetch + prune-on-`version` logic, the `basename`/
   * `stripMd` helpers, and the markup / test-ids / styles. It drops the desktop
   * `tagsNav`/`focus` keyboard-nav Region infra (editor-only), using plain
   * clicks + a local expanded Set. Re-queries when `version` bumps (bumped by
   * the viewer on each live-reload change event).
   */
  import { backend } from '$lib/ipc';
  import { basename, stripMd } from '$lib/path';
  import type { TagCount } from '$lib/types';

  interface Props {
    /** Bumped on live-reload change events; re-query when it changes. */
    version: number;
    /** path of the currently-open Concept, for highlighting. */
    selected: string | null;
    /** Open a Concept (routes through the viewer's `?path=` nav). */
    onopen: (path: string) => void;
  }

  let { version, selected, onopen }: Props = $props();

  let tags = $state<TagCount[]>([]);
  let expanded = $state(new Set<string>());
  let conceptCache = $state(new Map<string, string[]>());

  // Load all tags whenever the version changes; prune expanded/cache entries
  // whose tag no longer exists (e.g. its last Concept was untagged on disk).
  $effect(() => {
    void version;
    let cancelled = false;
    void backend.allTags().then((result) => {
      if (cancelled) return;
      tags = result;
      const live = new Set(result.map((t) => t.tag));
      const nextExpanded = new Set<string>();
      for (const t of expanded) if (live.has(t)) nextExpanded.add(t);
      if (nextExpanded.size !== expanded.size) expanded = nextExpanded;
      const nextCache = new Map<string, string[]>();
      for (const [t, c] of conceptCache) if (live.has(t)) nextCache.set(t, c);
      if (nextCache.size !== conceptCache.size) conceptCache = nextCache;
    });
    return () => {
      cancelled = true;
    };
  });

  // Re-query the Concept list for every expanded tag (also on version changes so
  // cached lists stay fresh). The expanded set is the reactive dependency.
  $effect(() => {
    void version;
    const open = [...expanded];
    let cancelled = false;
    for (const tag of open) {
      void backend.conceptsByTag(tag).then((result) => {
        if (cancelled) return;
        const next = new Map(conceptCache);
        next.set(tag, result);
        conceptCache = next;
      });
    }
    return () => {
      cancelled = true;
    };
  });

  function conceptsOf(tag: string): string[] {
    return conceptCache.get(tag) ?? [];
  }

  function toggleTag(tag: string) {
    const next = new Set(expanded);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    expanded = next;
  }

  /** Leaf name of a path, sans `.md` (the full path is on hover). */
  function label(p: string): string {
    return stripMd(basename(p));
  }
</script>

<!-- Hidden entirely when the Bundle has no tags (as on desktop). -->
{#if tags.length > 0}
  <section class="tag-browser" aria-label="Tags" data-testid="tag-browser">
    <h2 class="section-title">Tags</h2>
    <ul class="tag-list" role="tree">
      {#each tags as { tag, count } (tag)}
        {@const open = expanded.has(tag)}
        <li>
          <div
            class="tag"
            data-testid="tag"
            data-tag={tag}
            role="treeitem"
            aria-expanded={open}
            aria-selected="false"
            tabindex="0"
            onclick={() => toggleTag(tag)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleTag(tag);
              }
            }}
          >
            <span class="twisty" class:open>▸</span>
            <span class="tag-name">{tag}</span>
            <span class="count" data-testid="tag-count">{count}</span>
          </div>

          {#if open}
            <ul class="concept-list" data-testid="tag-concepts">
              {#each conceptsOf(tag) as path (path)}
                <li>
                  <div
                    class="concept"
                    class:selected={selected === path}
                    data-testid="tag-concept"
                    data-path={path}
                    title={path}
                    role="treeitem"
                    aria-selected={selected === path}
                    tabindex="0"
                    onclick={() => onopen(path)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onopen(path);
                      }
                    }}
                  >
                    {label(path)}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .tag-browser {
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
    font-family: var(--font-ui, system-ui, sans-serif);
    border-top: 1px solid var(--border, #e2e2e2);
  }

  .section-title {
    margin: 0 0 0.4rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #777);
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
    gap: 0.35rem;
    width: 100%;
    padding: 0.15rem 0.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    transition: background 0.12s ease;
  }

  .tag:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .twisty {
    flex: 0 0 auto;
    display: inline-block;
    width: 1em;
    transition: transform 0.1s ease;
    color: var(--text-muted, #777);
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
    color: var(--text-faint, #999);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .concept-list {
    margin: 0.05rem 0 0.15rem;
    padding-left: 0.6rem;
    margin-left: 0.5rem;
    border-left: 1px solid var(--border, #e2e2e2);
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
    border-radius: var(--radius-sm, 4px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 0.12s ease;
  }

  .concept:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .concept.selected {
    background: var(--accent-soft, rgba(80, 120, 255, 0.2));
    color: var(--tag-text, inherit);
  }
</style>
