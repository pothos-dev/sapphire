<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { backend } from '$lib/ipc';
  import { bundle } from '$lib/state/bundle.svelte';
  import { editor } from '$lib/state/editor.svelte';
  import { indexStore } from '$lib/state/index.svelte';
  import { buildEditor, setEditorDoc, refreshBrokenLinkDecorations } from '$lib/editor/cm';
  import { resolveLink } from '$lib/links';
  import Tree from '$lib/components/Tree.svelte';
  import Properties from '$lib/components/Properties.svelte';
  import Backlinks from '$lib/components/Backlinks.svelte';
  import TagBrowser from '$lib/components/TagBrowser.svelte';

  let editorParent = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;

  onMount(() => {
    void bundle.load();
    // Seed the broken-link existence cache from the Bundle index.
    void indexStore.refresh();

    // Subscribe to filesystem changes from the backend watcher. On any change:
    // refresh the tree (add/remove/rename), reload the open Concept if it
    // changed, and refresh the index's existing-path set so broken-link styling
    // restyles created/removed targets. Emerald's own autosave writes are
    // suppressed by the backend, so they never arrive here (no reload loop).
    const unsubscribe = backend.onFileChanged((change) => {
      void bundle.load();
      void editor.onExternalChange(change.kind, change.paths);
      void indexStore.refresh();
    });

    // Browser-style history shortcuts: Alt+Left = Back, Alt+Right = Forward.
    const onKeydown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void editor.back();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        void editor.forward();
      }
    };
    window.addEventListener('keydown', onKeydown);

    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onKeydown);
      view?.destroy();
      view = null;
    };
  });

  // Build / update the CodeMirror view whenever the open Concept content changes.
  $effect(() => {
    const content = editor.content;
    if (!editorParent) return;

    if (!view) {
      view = buildEditor({
        parent: editorParent,
        doc: content,
        readOnly: false,
        onChange: (doc) => editor.edit(doc),
        onBlur: () => void editor.flush(),
        onLinkClick: handleLinkClick,
        brokenLinkContext: {
          currentPath: () => editor.path ?? '',
          exists: (path) => indexStore.exists(path),
        },
      });
    } else {
      // No-op when content is unchanged (guards against feedback from edits).
      setEditorDoc(view, content);
    }
  });

  // Keep broken-link styling fresh: re-run the decoration whenever the index's
  // existing-path set changes (file-changed → indexStore.version bumps) or the
  // open Concept switches (relative links resolve against a new base path).
  $effect(() => {
    // Track both reactive deps so the effect re-runs on either change.
    void indexStore.version;
    void editor.path;
    if (view) refreshBrokenLinkDecorations(view);
  });

  function openConcept(path: string) {
    void editor.open(path);
  }

  // OKF link navigation (slice 5). A rendered-link click in the live preview is
  // routed here: external links open in a browser tab (preserving prior
  // behavior); bundle-absolute / relative links resolve against the open
  // Concept's path and navigate the single editor pane (pushing history).
  function handleLinkClick(href: string) {
    const open = editor.path ?? '';
    const target = resolveLink(open, href);
    if (target.kind === 'external') {
      window.open(target.href, '_blank', 'noopener,noreferrer');
    } else if (target.kind === 'internal') {
      void editor.open(target.path);
    }
    // 'none' (pure anchor / empty): no navigation.
  }

  // A frontmatter property edit produces new full markdown; route it through the
  // same edit/autosave path as editor typing. The build $effect above syncs the
  // CodeMirror view from `editor.content`, so the body view stays consistent.
  function onPropertiesChange(content: string) {
    editor.edit(content);
    void editor.flush();
  }
</script>

<div class="app">
  <aside class="tree-pane" aria-label="Bundle tree">
    {#if bundle.loading}
      <p class="status">Loading…</p>
    {:else if bundle.error}
      <p class="status error">{bundle.error}</p>
    {:else if bundle.tree}
      <div class="tree-root" data-testid="tree">
        {#each bundle.tree.children ?? [] as child (child.path)}
          <Tree node={child} selected={editor.path} onopen={openConcept} />
        {/each}
      </div>
    {/if}
  </aside>

  <main class="editor-pane" aria-label="Concept">
    <nav class="nav-bar" aria-label="Navigation history">
      <button
        type="button"
        class="nav-btn"
        data-testid="nav-back"
        title="Back (Alt+Left)"
        aria-label="Back"
        disabled={!editor.canGoBack}
        onclick={() => void editor.back()}>←</button
      >
      <button
        type="button"
        class="nav-btn"
        data-testid="nav-forward"
        title="Forward (Alt+Right)"
        aria-label="Forward"
        disabled={!editor.canGoForward}
        onclick={() => void editor.forward()}>→</button
      >
    </nav>
    {#if editor.error}
      <p class="status error">{editor.error}</p>
    {/if}
    {#if !editor.path && !editor.error}
      <p class="placeholder" data-testid="placeholder">Select a Concept from the tree.</p>
    {/if}
    {#if editor.path}
      <Properties content={editor.content} onchange={onPropertiesChange} />
    {/if}
    <div
      class="editor-host"
      class:hidden={!editor.path}
      data-testid="editor"
      bind:this={editorParent}
    ></div>
  </main>

  <!-- Right-hand sidebar: Backlinks for the open Concept + the Tag browser.
       Both refresh via the shared index `version` signal (bumped on every
       file-changed), the same mechanism the broken-link cache uses — so no
       bespoke refresh path. Selecting an entry routes through `openConcept`
       (editor navigation), so it participates in back/forward history. -->
  <aside class="side-pane" aria-label="Backlinks and tags" data-testid="side-pane">
    <Backlinks path={editor.path} version={indexStore.version} onopen={openConcept} />
    <TagBrowser version={indexStore.version} selected={editor.path} onopen={openConcept} />
  </aside>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
  }

  :global(body) {
    font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
    color: #0f0f0f;
    background: #f6f6f6;
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      color: #e6e6e6;
      background: #1e1e1e;
    }
  }

  .app {
    display: grid;
    grid-template-columns: 280px 1fr 260px;
    height: 100vh;
    overflow: hidden;
  }

  .side-pane {
    overflow: auto;
    border-left: 1px solid rgba(127, 127, 127, 0.3);
  }

  .tree-pane {
    overflow: auto;
    border-right: 1px solid rgba(127, 127, 127, 0.3);
    padding: 0.5rem;
    font-size: 0.9rem;
  }

  .editor-pane {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .nav-bar {
    display: flex;
    gap: 0.25rem;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.2);
  }

  .nav-btn {
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    line-height: 1;
  }

  .nav-btn:hover:not(:disabled) {
    background: rgba(127, 127, 127, 0.15);
  }

  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .editor-host {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .editor-host.hidden {
    display: none;
  }

  .editor-host :global(.cm-editor) {
    height: 100%;
  }

  .placeholder,
  .status {
    padding: 1rem;
    color: #888;
  }

  .status.error {
    color: #c0392b;
  }
</style>
