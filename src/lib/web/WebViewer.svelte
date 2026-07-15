<script lang="ts">
  import type { TreeNode } from '$lib/types';
  import { backend } from '$lib/ipc';
  import { errMessage } from '$lib/errors';
  import WebTree from './WebTree.svelte';

  interface Props {
    /** SSR'd data from `+page.ts`'s `load` (talks to the Rust server). */
    data: {
      bundleRoot: string;
      tree: TreeNode;
    };
  }

  let { data }: Props = $props();

  // The read-only web viewer shell: an Explorer tree (SSR'd from `data.tree`)
  // beside a read-only pane showing the selected Concept's RAW markdown. There
  // is NO write path and NO create/rename/delete/edit affordance anywhere — the
  // web build is read-only by design (this slice and beyond).
  //
  // The tree is server-rendered so it appears in the initial HTML and then
  // hydrates; clicking a Concept fetches its raw markdown through the `http.ts`
  // Backend seam (same-origin `/api/concept`, proxied to the Rust server).
  let selected = $state<string | null>(null);
  let content = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function openConcept(path: string) {
    selected = path;
    error = null;
    loading = true;
    try {
      content = await backend.readConcept(path);
    } catch (e) {
      content = null;
      error = errMessage(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="web-viewer" data-testid="web-viewer">
  <aside class="explorer" aria-label="Explorer">
    <header class="explorer-head">
      <h1 class="brand">Sapphire</h1>
      <p class="bundle-root" data-testid="bundle-root" title={data.bundleRoot}>{data.bundleRoot}</p>
    </header>
    <nav class="tree" data-testid="web-tree" aria-label="Bundle">
      <WebTree node={data.tree} {selected} onopen={openConcept} />
    </nav>
  </aside>

  <main class="reader" aria-label="Concept">
    {#if error}
      <p class="status error" data-testid="reader-error">{error}</p>
    {:else if selected === null}
      <p class="status" data-testid="reader-empty">Select a Concept to read its markdown.</p>
    {:else}
      <header class="reader-head">
        <span class="reader-path" data-testid="reader-path">{selected}</span>
        {#if loading}<span class="reader-loading">Loading…</span>{/if}
      </header>
      <!-- RAW markdown, read-only. Rendering/live-preview is a later slice. -->
      <pre class="raw" data-testid="reader-raw">{content ?? ''}</pre>
    {/if}
  </main>
</div>

<style>
  .web-viewer {
    display: grid;
    grid-template-columns: minmax(220px, 300px) 1fr;
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
    padding: 1rem 1.25rem;
  }

  .reader-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .reader-path {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted, #777);
  }

  .reader-loading {
    font-size: 0.75rem;
    color: var(--text-muted, #777);
  }

  .raw {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .status {
    color: var(--text-muted, #777);
  }

  .status.error {
    color: var(--danger, #c0392b);
  }
</style>
