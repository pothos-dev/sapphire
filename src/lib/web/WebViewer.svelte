<script lang="ts">
  import type { TreeNode } from '$lib/types';
  import type { RenderPayload } from './render';
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { backend } from '$lib/ipc';
  import WebTree from './WebTree.svelte';

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

  // Live reload (SSE): subscribe to filesystem changes on mount. When any
  // Concept changes on disk (created/modified/removed by an external tool),
  // re-run `load` — which re-fetches the tree AND re-renders the open Concept
  // through the /api proxy — so the tree refreshes and the open Concept updates
  // without a manual reload. This mirrors how the desktop reacts to
  // `onFileChanged` (reload tree + reload open Concept). `onFileChanged` is a
  // no-op under SSR (no EventSource); the returned unsubscribe closes the stream
  // on teardown. Subscribed once here (not per Concept) so the connection is
  // stable across in-viewer navigation.
  onMount(() => backend.onFileChanged(() => void invalidateAll()));
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

  {#if data.rendered && data.rendered.outline.length > 0}
    <aside class="outline" aria-label="Outline" data-testid="outline">
      <h2 class="outline-title">Outline</h2>
      <ul>
        {#each data.rendered.outline as h (h.slug)}
          <li style="padding-left: {(h.level - 1) * 12}px"><a href="#{h.slug}">{h.text}</a></li>
        {/each}
      </ul>
    </aside>
  {/if}
</div>

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

  .outline {
    border-left: 1px solid var(--border, #e2e2e2);
    padding: 1rem 0.75rem;
    overflow: auto;
    min-width: 12rem;
    font-size: 0.8rem;
  }

  .outline-title {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #777);
  }

  .outline ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .outline a {
    color: inherit;
    text-decoration: none;
  }

  .outline a:hover {
    text-decoration: underline;
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
