<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { backend } from '$lib/ipc';
  import { bundle } from '$lib/state/bundle.svelte';
  import { editor } from '$lib/state/editor.svelte';
  import { buildEditor, setEditorDoc } from '$lib/editor/cm';
  import Tree from '$lib/components/Tree.svelte';

  let editorParent = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;

  onMount(() => {
    void bundle.load();

    // Subscribe to filesystem changes from the backend watcher. On any change:
    // refresh the tree (add/remove/rename) and reload the open Concept if it
    // changed. Emerald's own autosave writes are suppressed by the backend, so
    // they never arrive here (no reload loop / cursor jump).
    const unsubscribe = backend.onFileChanged((change) => {
      void bundle.load();
      void editor.onExternalChange(change.kind, change.paths);
    });

    return () => {
      unsubscribe();
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
      });
    } else {
      // No-op when content is unchanged (guards against feedback from edits).
      setEditorDoc(view, content);
    }
  });

  function openConcept(path: string) {
    void editor.open(path);
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
    {#if editor.error}
      <p class="status error">{editor.error}</p>
    {/if}
    {#if !editor.path && !editor.error}
      <p class="placeholder" data-testid="placeholder">Select a Concept from the tree.</p>
    {/if}
    <div
      class="editor-host"
      class:hidden={!editor.path}
      data-testid="editor"
      bind:this={editorParent}
    ></div>
  </main>
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
    grid-template-columns: 280px 1fr;
    height: 100vh;
    overflow: hidden;
  }

  .tree-pane {
    overflow: auto;
    border-right: 1px solid rgba(127, 127, 127, 0.3);
    padding: 0.5rem;
    font-size: 0.9rem;
  }

  .editor-pane {
    position: relative;
    overflow: auto;
    min-width: 0;
  }

  .editor-host {
    height: 100%;
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
