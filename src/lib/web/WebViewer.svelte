<script lang="ts">
  import type { TreeNode, TagCount } from '$lib/types';
  import type { RenderPayload } from './render';
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { backend } from '$lib/ipc';
  import { theme, type ThemeMode } from '$lib/state/theme.svelte';
  import { ordinaryChildren, defaultOpenFolders, reservedChildren } from '$lib/treeNav';
  import { RESERVED_FILES, type ReservedKind } from '$lib/reserved';
  import SidebarSection from '$lib/components/SidebarSection.svelte';
  import WebTree from './WebTree.svelte';
  import WebSearch from './WebSearch.svelte';
  import WebTags from './WebTags.svelte';
  import WebOutline from './WebOutline.svelte';
  import WebBacklinks from './WebBacklinks.svelte';
  import { hydrateMermaid } from './webMermaid';

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

  // The read-only "Sapphire Web" viewer — shaped to resemble the desktop shell:
  // an app header (brand + Bundle root + light/dark toggle), a left Sidebar
  // Accordion (Explorer + Tags) and a right Sidebar Accordion (Outline +
  // Backlinks) reusing the desktop `SidebarSection`, and the server-rendered
  // Concept in the centre. There is NO write path / editor / CodeMirror.

  function open(path: string) {
    void goto(`?path=${encodeURIComponent(path)}`, { keepFocus: true });
  }

  // --- Theme (dark-by-default: follows the OS, overridable via the toggle) ---
  // Reuses the desktop `theme` store: `theme.start()` tracks `prefers-color-
  // scheme`; an $effect applies `data-theme={theme.resolved}` to the app root
  // (exactly like desktop App.svelte), so the CSS tokens follow the OS instead
  // of falling back to light. The toggle sets an explicit mode, persisted in
  // localStorage across reloads.
  const THEME_KEY = 'sapphire:webTheme';
  let appRoot = $state<HTMLElement | null>(null);

  $effect(() => {
    const resolved = theme.resolved;
    if (appRoot) appRoot.setAttribute('data-theme', resolved);
  });

  // Persist the chosen mode across reloads.
  $effect(() => {
    const mode = theme.mode;
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, mode);
  });

  function toggleTheme() {
    // Flip to an explicit scheme opposite the one currently shown.
    theme.mode = theme.resolved === 'dark' ? 'light' : 'dark';
  }

  // --- Search (Ctrl+Shift+F) ---
  let searchOpen = $state(false);
  function openSearchHit(path: string) {
    open(path);
  }

  // --- Index-version signal for Backlinks + Tags (bumped on live-reload) ---
  let indexVersion = $state(0);

  // The Bundle's tags (owned here so the whole Tags Section — header included —
  // can be hidden when there are none, as on desktop). Re-fetched on each change.
  let tags = $state<TagCount[]>([]);
  const tagsPresent = $derived(tags.length > 0);
  $effect(() => {
    void indexVersion;
    let cancelled = false;
    void backend.allTags().then((result) => {
      if (!cancelled) tags = result;
    });
    return () => {
      cancelled = true;
    };
  });

  // --- Explorer tree: local expanded-folder state (seeded like desktop) ---
  let expandedFolders = $state(new Set<string>());
  let seeded = false;
  $effect(() => {
    if (seeded || !data.tree) return;
    const next = new Set(expandedFolders);
    for (const p of defaultOpenFolders(data.tree, 2)) next.add(p);
    expandedFolders = next;
    seeded = true;
  });
  const isExpanded = (path: string): boolean => expandedFolders.has(path);
  function setExpanded(path: string, open: boolean): void {
    const next = new Set(expandedFolders);
    if (open) next.add(path);
    else next.delete(path);
    expandedFolders = next;
  }

  // Root-level ordinary children + reserved files (index.md/log.md), the latter
  // surfaced as header affordances rather than tree rows (mirrors desktop).
  const rootOrdinary = $derived(data.tree ? ordinaryChildren(data.tree) : []);
  const rootReserved = $derived(data.tree ? reservedChildren(data.tree) : []);
  const RESERVED_GLYPH: Record<ReservedKind, string> = { index: '☰', log: '🕑' };

  // --- Sidebar Accordion collapse state + `--expanded-count` (desktop parity) ---
  let explorerOpen = $state(true);
  let tagsOpen = $state(true);
  let outlineOpen = $state(true);
  let backlinksOpen = $state(true);
  const leftCount = $derived((explorerOpen ? 1 : 0) + (tagsPresent && tagsOpen ? 1 : 0));
  const rightCount = $derived((outlineOpen ? 1 : 0) + (backlinksOpen ? 1 : 0));

  // --- Outline scroll-to-heading (render gives each heading `id="<slug>"`) ---
  function scrollToHeading(slug: string) {
    document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // --- Mermaid Diagrams (hydrated client-side, themed by `theme.resolved`) ---
  let articleEl = $state<HTMLElement | null>(null);
  // Re-render on Concept navigation / live-reload (the `{@html}` swap yields
  // fresh inert blocks) AND on a theme flip (baked SVGs re-render in the new
  // palette) — reading the SAME resolved theme as the rest of the viewer.
  $effect(() => {
    void data.rendered?.html;
    const resolved = theme.resolved;
    const el = articleEl;
    if (el) void hydrateMermaid(el, resolved);
  });

  onMount(() => {
    // Seed the theme mode from localStorage, then start tracking the OS scheme.
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      theme.mode = stored as ThemeMode;
    }
    const stopTheme = theme.start();

    // Live reload (SSE): re-query Backlinks + Tags and re-render the open Concept.
    const unsubscribe = backend.onFileChanged(() => {
      indexVersion += 1;
      void invalidateAll();
    });

    // Ctrl/Cmd+Shift+F toggles the Search modal (capture phase).
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchOpen = !searchOpen;
      }
    };
    window.addEventListener('keydown', onKeydown, true);

    return () => {
      stopTheme();
      unsubscribe();
      window.removeEventListener('keydown', onKeydown, true);
    };
  });
</script>

<div class="app" data-testid="web-viewer" bind:this={appRoot}>
  <header class="app-header">
    <div class="brand-block">
      <span class="brand">Sapphire</span>
      <span class="bundle-root" data-testid="bundle-root" title={data.bundleRoot}>{data.bundleRoot}</span>
    </div>
    <button
      type="button"
      class="theme-toggle"
      data-testid="theme-toggle"
      title="Toggle light / dark theme"
      aria-label="Toggle light / dark theme"
      onclick={toggleTheme}
    >{theme.resolved === 'dark' ? '☀' : '☾'}</button>
  </header>

  <div class="app-body">
    <aside class="side-bar left" aria-label="Sidebar" style="--expanded-count: {leftCount}">
      <SidebarSection
        title="Explorer"
        testid="explorer-section"
        expanded={explorerOpen}
        ontoggle={() => (explorerOpen = !explorerOpen)}
      >
        {#snippet actions()}
          {#if rootReserved.length > 0}
            <div class="root-reserved" data-testid="root-reserved">
              {#each rootReserved as r (r.path)}
                <button
                  type="button"
                  class="reserved-btn"
                  class:selected={data.selected === r.path}
                  title={`Open ${RESERVED_FILES[r.kind]} (Bundle root)`}
                  aria-label={`Open ${RESERVED_FILES[r.kind]}`}
                  data-reserved-path={r.path}
                  data-reserved-kind={r.kind}
                  onclick={() => open(r.path)}
                >{RESERVED_GLYPH[r.kind]}</button>
              {/each}
            </div>
          {/if}
        {/snippet}
        <nav class="tree" data-testid="web-tree" aria-label="Bundle">
          {#each rootOrdinary as child (child.path)}
            <WebTree node={child} selected={data.selected} onopen={open} {isExpanded} {setExpanded} />
          {/each}
        </nav>
      </SidebarSection>

      {#if tagsPresent}
        <SidebarSection
          title="Tags"
          testid="tags-section"
          expanded={tagsOpen}
          ontoggle={() => (tagsOpen = !tagsOpen)}
        >
          <WebTags {tags} version={indexVersion} selected={data.selected} onopen={open} />
        </SidebarSection>
      {/if}
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
        <article class="rendered" data-testid="rendered" bind:this={articleEl}>
          {@html data.rendered.html}
        </article>
      {/if}
    </main>

    {#if data.rendered}
      <aside class="side-bar right" aria-label="Sidebar" style="--expanded-count: {rightCount}">
        <SidebarSection
          title="Outline"
          testid="outline-section"
          expanded={outlineOpen}
          ontoggle={() => (outlineOpen = !outlineOpen)}
        >
          <WebOutline outline={data.rendered.outline} onselect={scrollToHeading} />
        </SidebarSection>
        <SidebarSection
          title="Backlinks"
          testid="backlinks-section"
          expanded={backlinksOpen}
          ontoggle={() => (backlinksOpen = !backlinksOpen)}
        >
          <WebBacklinks path={data.selected} version={indexVersion} onopen={open} />
        </SidebarSection>
      </aside>
    {/if}
  </div>
</div>

<WebSearch open={searchOpen} onopen={openSearchHit} onclose={() => (searchOpen = false)} />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--font-ui, system-ui, sans-serif);
    color: var(--text, #222);
    background: var(--bg, #fff);
  }

  .app-header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    height: 2.5rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--border, #e2e2e2);
    background: var(--bg-elevated, #f9fafc);
  }

  .brand-block {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .brand {
    font-weight: 700;
    font-size: 0.95rem;
  }

  .bundle-root {
    font-size: 0.72rem;
    color: var(--text-muted, #777);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .theme-toggle {
    flex: none;
    width: 1.9rem;
    height: 1.9rem;
    border: 1px solid var(--border, #ccc);
    border-radius: var(--radius-sm, 6px);
    background: var(--bg, #fff);
    color: var(--text, #222);
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }

  .theme-toggle:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .app-body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(200px, 260px) minmax(0, 1fr) auto;
  }

  .side-bar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .side-bar.left {
    border-right: 1px solid var(--border, #e2e2e2);
  }

  .side-bar.right {
    border-left: 1px solid var(--border, #e2e2e2);
    min-width: 13rem;
    max-width: 18rem;
  }

  .root-reserved {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }

  .reserved-btn {
    width: 1.4rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    opacity: 0.55;
  }

  .reserved-btn:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
    opacity: 1;
  }

  .reserved-btn.selected {
    opacity: 1;
    background: var(--accent-soft, rgba(80, 120, 255, 0.2));
    color: var(--tag-text, inherit);
  }

  .tree {
    padding: 0.25rem 0.35rem;
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
    background: var(--bg-elevated, rgba(127, 127, 127, 0.06));
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
    background: var(--bg-sunken, rgba(127, 127, 127, 0.1));
  }

  .rendered :global(code) {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
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

  /* Mermaid Diagrams (hydrated client-side from inert code blocks). The
     containers are created by webMermaid.ts inside `{@html}` content, so these
     rules are `:global` under `.rendered`. */
  .rendered :global(.web-mermaid) {
    margin: 1rem 0;
  }

  .rendered :global(.web-mermaid-render) {
    display: flex;
    justify-content: center;
  }

  .rendered :global(.web-mermaid-render svg) {
    max-width: 100%;
    height: auto;
  }

  .rendered :global(.web-mermaid-loading) {
    color: var(--text-muted, #888);
    font-style: italic;
    font-size: 0.9em;
    padding: 0.5rem 0;
  }

  /* A failed render: a bordered panel (message + raw source) — visibly distinct
     from a plain code block so a broken diagram reads as broken. */
  .rendered :global(.web-mermaid-error) {
    border: 1px solid var(--danger, #d33);
    border-radius: var(--radius-sm, 4px);
    background: var(--danger-soft, rgba(221, 51, 51, 0.08));
    padding: 0.6rem 0.75rem;
  }

  .rendered :global(.web-mermaid-error-heading) {
    color: var(--danger, #d33);
    font-weight: 600;
    font-size: 0.85em;
    margin-bottom: 0.35rem;
  }

  .rendered :global(.web-mermaid-error-message) {
    color: var(--danger, #d33);
    font-size: 0.85em;
    white-space: pre-wrap;
    margin-bottom: 0.5rem;
  }

  .rendered :global(.web-mermaid-error-source) {
    margin: 0;
    padding: 0.5rem;
    border-radius: var(--radius-sm, 4px);
    background: var(--bg-sunken, rgba(0, 0, 0, 0.06));
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85em;
    white-space: pre-wrap;
    overflow-x: auto;
  }
</style>
