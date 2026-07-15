<script lang="ts">
  import type { TreeNode } from '$lib/types';
  import type { RenderPayload } from './render';
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { backend } from '$lib/ipc';
  import WebTree from './WebTree.svelte';
  import WebSearch from './WebSearch.svelte';
  import WebTags from './WebTags.svelte';
  import WebOutline from './WebOutline.svelte';
  import WebBacklinks from './WebBacklinks.svelte';

  interface Props {
    /** SSR'd data from `+page.ts`'s `load` (talks to the Rust server). */
    data: {
      bundleRoot: string;
      tree: TreeNode;
      selected: string | null;
      rendered: RenderPayload | null;
      renderError: string | null;
    };
  }

  let { data }: Props = $props();

  // The read-only "Sapphire Web" viewer shell: an Explorer tree beside the
  // server-RENDERED Concept (HTML + read-only Properties + Outline). There is NO
  // write path and NO create/rename/delete/edit affordance — read-only by design.
  //
  // Navigation is URL-driven so the server render re-runs on every Concept
  // switch: opening a Concept sets `?path=`, which re-runs `+page.ts`'s `load`
  // (SSR on first paint, client-side on subsequent nav through the /api proxy).
  // In-Bundle links in the rendered HTML are plain relative anchors
  // (`href="?path=…"`), so SvelteKit's client router intercepts the click and
  // navigates WITHIN the viewer — no browser navigation away, no manual handler.
  function open(path: string) {
    void goto(`?path=${encodeURIComponent(path)}`, { keepFocus: true });
  }

  // Bundle-wide Search (Ctrl+Shift+F). A hydrated island; opening a hit routes
  // through the same `?path=` navigation as links. (The web view renders HTML,
  // which has no source-line mapping, so we open the Concept at the hit — a
  // line-level scroll like the desktop editor's is not applicable here.)
  let searchOpen = $state(false);
  function openSearchHit(path: string) {
    open(path);
  }

  // Index-version signal for the index-backed Sections (Backlinks, Tags): the
  // desktop threads this so those views re-query on `file-changed`. We bump it on
  // each live-reload change event; Outline rides the render re-run (invalidateAll).
  let indexVersion = $state(0);

  // Outline click → scroll the rendered view to the heading (render gives each
  // heading `id="<slug>"` matching the outline slugs).
  function scrollToHeading(slug: string) {
    document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  onMount(() => {
    // Live reload (SSE): subscribe to filesystem changes. When any Concept
    // changes on disk (created/modified/removed by an external tool), re-run
    // `load` — which re-fetches the tree AND re-renders the open Concept through
    // the /api proxy — so the tree refreshes and the open Concept updates
    // without a manual reload. Mirrors the desktop's `onFileChanged` reaction;
    // it is a no-op under SSR (no EventSource) and its unsubscribe closes the
    // stream on teardown. Subscribed once (not per Concept) so the connection is
    // stable across in-viewer navigation.
    const unsubscribe = backend.onFileChanged(() => {
      indexVersion += 1; // re-query Backlinks + Tags
      void invalidateAll(); // re-fetch tree + re-render open Concept (Outline)
    });

    // Ctrl/Cmd+Shift+F toggles the Search modal (capture phase so it wins even
    // if focus is inside the search input). Requires Shift so it never collides
    // with a browser find.
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchOpen = !searchOpen;
      }
    };
    window.addEventListener('keydown', onKeydown, true);

    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onKeydown, true);
    };
  });
</script>

<div class="web-viewer" data-testid="web-viewer">
  <aside class="explorer" aria-label="Explorer">
    <header class="explorer-head">
      <h1 class="brand">Sapphire</h1>
      <p class="bundle-root" data-testid="bundle-root" title={data.bundleRoot}>{data.bundleRoot}</p>
    </header>
    <nav class="tree" data-testid="web-tree" aria-label="Bundle">
      <WebTree node={data.tree} selected={data.selected} onopen={open} />
    </nav>
    <!-- Tags Section (hidden entirely when the Bundle has no tags). -->
    <WebTags version={indexVersion} selected={data.selected} onopen={open} />
  </aside>

  <main class="reader" aria-label="Concept">
    {#if data.renderError}
      <p class="status error" data-testid="reader-error">
        Cannot render {data.selected}: {data.renderError}
      </p>
    {:else if data.rendered === null}
      <p class="status" data-testid="reader-empty">Select a Concept to read it.</p>
    {:else}
      <header class="reader-head">
        <span class="reader-path" data-testid="reader-path">{data.selected}</span>
      </header>

      {#if data.rendered.frontmatter.length > 0}
        <!-- Read-only Properties view (frontmatter lives outside the body). -->
        <dl class="properties" data-testid="properties">
          {#each data.rendered.frontmatter as field (field.key)}
            <dt>{field.key}</dt>
            <dd>
              {#if field.values.length > 1}
                <ul class="prop-list">
                  {#each field.values as v, i (i)}<li>{v}</li>{/each}
                </ul>
              {:else}
                {field.values[0] ?? ''}
              {/if}
            </dd>
          {/each}
        </dl>
      {/if}

      <!-- Server-rendered body HTML. Links resolve to viewer nav / broken
           markers in Rust; SvelteKit intercepts the in-Bundle anchors. -->
      <article class="rendered" data-testid="rendered">
        {@html data.rendered.html}
      </article>
    {/if}
  </main>

  {#if data.rendered}
    <!-- Right Sidebar: index-backed Sections for the open Concept. -->
    <aside class="right-bar" aria-label="Sidebar">
      <WebOutline outline={data.rendered.outline} onselect={scrollToHeading} />
      <div class="right-section">
        <h2 class="section-title">Backlinks</h2>
        <WebBacklinks path={data.selected} version={indexVersion} onopen={open} />
      </div>
    </aside>
  {/if}
</div>

<WebSearch open={searchOpen} onopen={openSearchHit} onclose={() => (searchOpen = false)} />

<style>
  .web-viewer {
    display: grid;
    grid-template-columns: minmax(200px, 260px) minmax(0, 1fr) auto;
    height: 100vh;
    font-family: var(--font, system-ui, sans-serif);
    color: var(--text, #222);
    background: var(--bg, #fff);
  }

  .explorer {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border, #e2e2e2);
    overflow: auto;
    padding: 0.5rem;
  }

  .explorer-head {
    padding: 0.25rem 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border, #e2e2e2);
    margin-bottom: 0.5rem;
  }

  .brand {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }

  .bundle-root {
    margin: 0.2rem 0 0;
    font-size: 0.7rem;
    color: var(--text-muted, #777);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reader {
    overflow: auto;
    padding: 1rem 1.5rem 4rem;
    min-width: 0;
  }

  .reader-head {
    margin-bottom: 0.5rem;
  }

  .reader-path {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted, #777);
  }

  .properties {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.15rem 0.75rem;
    margin: 0 0 1.25rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border, #e2e2e2);
    border-radius: var(--radius-sm, 6px);
    background: var(--hover, rgba(127, 127, 127, 0.06));
    font-size: 0.82rem;
  }

  .properties dt {
    font-weight: 600;
    color: var(--text-muted, #666);
  }

  .properties dd {
    margin: 0;
  }

  .prop-list {
    margin: 0;
    padding-left: 1rem;
  }

  .right-bar {
    border-left: 1px solid var(--border, #e2e2e2);
    overflow: auto;
    min-width: 13rem;
    max-width: 18rem;
    font-size: 0.8rem;
  }

  .right-section {
    border-top: 1px solid var(--border, #e2e2e2);
    padding: 0.6rem 0.75rem 0.2rem;
  }

  .right-section .section-title {
    margin: 0 0 0.2rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #777);
  }

  .status {
    color: var(--text-muted, #777);
  }

  .status.error {
    color: var(--danger, #c0392b);
  }

  /* Rendered body typography + link styling. `{@html}` content is NOT scoped,
     so these rules are `:global` under `.rendered`. */
  .rendered :global(h1),
  .rendered :global(h2),
  .rendered :global(h3) {
    line-height: 1.25;
    margin: 1.4em 0 0.5em;
  }

  .rendered :global(h1) {
    margin-top: 0;
  }

  .rendered :global(p),
  .rendered :global(li) {
    line-height: 1.6;
  }

  .rendered :global(pre) {
    overflow: auto;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm, 6px);
    background: var(--hover, rgba(127, 127, 127, 0.1));
  }

  .rendered :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
  }

  .rendered :global(table) {
    border-collapse: collapse;
  }

  .rendered :global(th),
  .rendered :global(td) {
    border: 1px solid var(--border, #ddd);
    padding: 0.3rem 0.55rem;
  }

  .rendered :global(a.internal-link) {
    color: var(--accent, #2d6cdf);
    text-decoration: none;
  }

  .rendered :global(a.internal-link:hover) {
    text-decoration: underline;
  }

  /* Broken in-Bundle link: present + clickable, but visually distinct. */
  .rendered :global(a.internal-link.broken) {
    color: var(--danger, #c0392b);
    text-decoration: underline dotted;
    cursor: help;
  }
</style>
