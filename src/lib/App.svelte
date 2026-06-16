<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { backend } from '$lib/ipc';
  import { bundle } from '$lib/state/bundle.svelte';
  import { editor } from '$lib/state/editor.svelte';
  import { indexStore } from '$lib/state/index.svelte';
  import { session } from '$lib/state/session.svelte';
  import { theme } from '$lib/state/theme.svelte';
  import type { TreeNode } from '$lib/types';
  import { buildEditor, setEditorDoc, refreshBrokenLinkDecorations } from '$lib/editor/cm';
  import { resolveLink } from '$lib/links';
  import Tree from '$lib/components/Tree.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import Properties from '$lib/components/Properties.svelte';
  import Backlinks from '$lib/components/Backlinks.svelte';
  import TagBrowser from '$lib/components/TagBrowser.svelte';
  import { treeActions } from '$lib/state/treeActions.svelte';

  let editorParent = $state<HTMLDivElement | null>(null);
  let appRoot = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;

  /** Collect bundle-relative paths of all directories at depth < `maxDepth`. */
  function defaultOpenFolders(node: TreeNode, depth: number, maxDepth: number, out: string[]) {
    if (!node.isDir) return;
    if (depth >= 0 && depth < maxDepth && node.path !== '') out.push(node.path);
    for (const child of node.children ?? []) {
      defaultOpenFolders(child, depth + 1, maxDepth, out);
    }
  }

  onMount(() => {
    // Apply the OS-driven theme and keep it live.
    const stopTheme = theme.start();

    // Load the Bundle, then restore persisted per-Bundle session state:
    // expanded folders + last-open Concept. Both must wait for their data
    // (the tree, the session) before applying.
    void (async () => {
      await Promise.all([bundle.load(), session.load()]);

      // Seed the default-open folders (depth < 2) for a FRESH Bundle (no stored
      // session). Otherwise honour exactly what was restored.
      if (
        bundle.tree &&
        session.expandedFolders.size === 0 &&
        session.lastOpenConcept === null
      ) {
        const defaults: string[] = [];
        // Root is depth -1 here so its direct children (folders) are depth 0.
        defaultOpenFolders(bundle.tree, -1, 2, defaults);
        for (const p of defaults) session.setExpanded(p, true);
      }

      // Restore the last-open Concept, then mark restoration complete so the
      // persistence effect/seeded defaults begin saving (gated until now so a
      // transient `editor.path === null` mid-restore cannot wipe stored state).
      if (session.lastOpenConcept) {
        await editor.open(session.lastOpenConcept);
      }
      session.endRestore();
    })();

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
      stopTheme();
      view?.destroy();
      view = null;
    };
  });

  // Apply the resolved theme as `data-theme` on the app root, so both the app
  // UI and the atomic-editor (cm.ts reads the inherited attribute) are themed
  // consistently. Re-runs when the OS scheme (or future mode) changes.
  $effect(() => {
    const resolved = theme.resolved;
    if (appRoot) appRoot.setAttribute('data-theme', resolved);
    // The atomic-editor reads `data-theme` on the CodeMirror root; keep it in
    // sync with the app theme so the editor is themed identically.
    if (view) view.dom.setAttribute('data-theme', resolved);
  });

  // Persist the last-open Concept whenever navigation changes it (tree click,
  // link, back/forward all funnel through `editor.path`).
  $effect(() => {
    const path = editor.path;
    if (session.restored) session.setLastOpenConcept(path);
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

  // --- Tree CRUD: context menu + dialogs (slice: tree-crud) ---

  type Dialog =
    | { kind: 'newConcept' | 'newFolder' | 'rename'; node: TreeNode; value: string }
    | { kind: 'move'; node: TreeNode; value: string }
    | { kind: 'delete'; node: TreeNode };

  // The open context menu (right-click / per-row ⋯), or null.
  let menu = $state<{ node: TreeNode; x: number; y: number } | null>(null);
  // The open modal dialog (name prompt / move picker / delete confirm), or null.
  let dialog = $state<Dialog | null>(null);

  /** The folder containing `path` ('' for the Bundle root). */
  function parentOf(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
  }

  /**
   * Folder a NEW child of `node` should live in: the node itself if it's a
   * directory, else its containing folder.
   */
  function childDirOf(node: TreeNode): string {
    return node.isDir ? node.path : parentOf(node.path);
  }

  /** Join a folder ('' = root) and a name into a bundle-relative path. */
  function joinPath(dir: string, name: string): string {
    return dir === '' ? name : `${dir}/${name}`;
  }

  /** All folder paths in the tree (for the Move picker), '' = Bundle root. */
  function folderPaths(node: TreeNode, out: string[] = []): string[] {
    if (node.isDir) {
      out.push(node.path);
      for (const child of node.children ?? []) folderPaths(child, out);
    }
    return out;
  }

  function openMenu(node: TreeNode, x: number, y: number) {
    menu = { node, x, y };
  }

  const MENU_ITEMS = [
    { id: 'newConcept', label: 'New Concept' },
    { id: 'newFolder', label: 'New Folder' },
    { id: 'rename', label: 'Rename', separated: true },
    { id: 'move', label: 'Move…' },
    { id: 'delete', label: 'Delete', separated: true, danger: true },
  ];

  function onMenuSelect(id: string) {
    const node = menu?.node;
    if (!node) return;
    if (id === 'newConcept') dialog = { kind: 'newConcept', node, value: '' };
    else if (id === 'newFolder') dialog = { kind: 'newFolder', node, value: '' };
    else if (id === 'rename') dialog = { kind: 'rename', node, value: node.name };
    else if (id === 'move') dialog = { kind: 'move', node, value: parentOf(node.path) };
    else if (id === 'delete') dialog = { kind: 'delete', node };
  }

  function closeDialog() {
    dialog = null;
  }

  async function confirmDialog() {
    if (!dialog) return;
    const d = dialog;
    if (d.kind === 'newConcept') {
      const name = d.value.trim();
      if (name === '') return;
      const file = name.endsWith('.md') ? name : `${name}.md`;
      await treeActions.createConcept(joinPath(childDirOf(d.node), file));
    } else if (d.kind === 'newFolder') {
      const name = d.value.trim();
      if (name === '') return;
      await treeActions.createFolder(joinPath(childDirOf(d.node), name));
    } else if (d.kind === 'rename') {
      const name = d.value.trim();
      if (name === '' || name === d.node.name) {
        closeDialog();
        return;
      }
      await treeActions.renamePath(d.node.path, joinPath(parentOf(d.node.path), name));
    } else if (d.kind === 'move') {
      await treeActions.movePath(d.node.path, d.value);
    } else if (d.kind === 'delete') {
      await treeActions.deletePath(d.node.path);
    }
    closeDialog();
  }
</script>

<div class="app" data-testid="app-root" bind:this={appRoot}>
  <aside class="tree-pane" aria-label="Bundle tree">
    {#if bundle.loading}
      <p class="status">Loading…</p>
    {:else if bundle.error}
      <p class="status error">{bundle.error}</p>
    {:else if bundle.tree}
      <div
        class="tree-root"
        data-testid="tree"
        oncontextmenu={(e) => {
          // Right-click on empty tree space targets the Bundle root.
          if (e.target === e.currentTarget && bundle.tree) {
            e.preventDefault();
            openMenu(bundle.tree, e.clientX, e.clientY);
          }
        }}
        role="tree"
        tabindex="-1"
      >
        {#each bundle.tree.children ?? [] as child (child.path)}
          <Tree node={child} selected={editor.path} onopen={openConcept} onmenu={openMenu} />
        {/each}
      </div>
      <button
        type="button"
        class="root-new"
        data-testid="root-new-concept"
        onclick={() => bundle.tree && openMenu(bundle.tree, 16, 80)}
      >+ New…</button>
    {/if}
    {#if treeActions.error}
      <p class="status error" data-testid="tree-error">{treeActions.error}</p>
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

  {#if menu}
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={MENU_ITEMS}
      onselect={onMenuSelect}
      onclose={() => (menu = null)}
    />
  {/if}

  {#if dialog}
    <div class="dialog-backdrop" role="presentation" onclick={closeDialog}></div>
    <div class="dialog" role="dialog" aria-modal="true" data-testid="tree-dialog">
      {#if dialog.kind === 'delete'}
        <p class="dialog-title">Delete “{dialog.node.name}”?</p>
        <p class="dialog-body">
          This {dialog.node.isDir ? 'folder and everything in it' : 'Concept'} will be
          permanently removed.
        </p>
        <div class="dialog-actions">
          <button type="button" onclick={closeDialog}>Cancel</button>
          <button
            type="button"
            class="danger"
            data-testid="dialog-confirm"
            onclick={confirmDialog}>Delete</button
          >
        </div>
      {:else if dialog.kind === 'move'}
        <p class="dialog-title">Move “{dialog.node.name}” to…</p>
        <select
          class="dialog-input"
          data-testid="dialog-move-target"
          bind:value={dialog.value}
        >
          {#each folderPaths(bundle.tree ?? { name: '', path: '', isDir: true, children: [] }) as dir (dir)}
            <option value={dir}>{dir === '' ? '/ (Bundle root)' : dir}</option>
          {/each}
        </select>
        <div class="dialog-actions">
          <button type="button" onclick={closeDialog}>Cancel</button>
          <button type="button" data-testid="dialog-confirm" onclick={confirmDialog}>Move</button>
        </div>
      {:else}
        <p class="dialog-title">
          {dialog.kind === 'newConcept'
            ? 'New Concept'
            : dialog.kind === 'newFolder'
              ? 'New Folder'
              : 'Rename'}
        </p>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="dialog-input"
          type="text"
          data-testid="dialog-input"
          placeholder={dialog.kind === 'newConcept' ? 'name (.md optional)' : 'name'}
          bind:value={dialog.value}
          autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void confirmDialog();
            }
          }}
        />
        <div class="dialog-actions">
          <button type="button" onclick={closeDialog}>Cancel</button>
          <button type="button" data-testid="dialog-confirm" onclick={confirmDialog}>
            {dialog.kind === 'rename' ? 'Rename' : 'Create'}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
  }

  :global(body) {
    font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  }

  /* Theme is driven by `data-theme` on the app root (set by the theme store,
     state/theme.svelte.ts — OS-driven default). The attribute is the single
     source of truth so the app UI and the atomic-editor stay consistent. */
  .app {
    display: grid;
    grid-template-columns: 280px 1fr 260px;
    height: 100vh;
    overflow: hidden;
    color: #0f0f0f;
    background: #f6f6f6;
  }

  /* `:global` because the attribute is set at runtime by the theme store, so
     Svelte's static analysis cannot see it (would flag the selector unused). */
  :global(.app[data-theme='dark']) {
    color: #e6e6e6;
    background: #1e1e1e;
  }

  /* Keep the document background in step with the app theme (covers overscroll
     and the area outside the grid). */
  :global(body:has(.app[data-theme='dark'])) {
    background: #1e1e1e;
    color: #e6e6e6;
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

  .root-new {
    margin: 0.25rem 0.1rem;
    padding: 0.2rem 0.5rem;
    border: 1px dashed rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    opacity: 0.8;
  }

  .root-new:hover {
    background: rgba(127, 127, 127, 0.12);
    opacity: 1;
  }

  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    background: rgba(0, 0, 0, 0.25);
  }

  .dialog {
    position: fixed;
    z-index: 1101;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: 280px;
    padding: 1rem;
    border-radius: 8px;
    background: #ffffff;
    color: #0f0f0f;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }

  :global(.app[data-theme='dark']) .dialog {
    background: #2a2a2a;
    color: #e6e6e6;
  }

  .dialog-title {
    margin: 0 0 0.5rem;
    font-weight: 600;
  }

  .dialog-body {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    color: #888;
  }

  .dialog-input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.5rem;
    margin-bottom: 0.75rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .dialog-actions button {
    padding: 0.35rem 0.8rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .dialog-actions button:hover {
    background: rgba(127, 127, 127, 0.15);
  }

  .dialog-actions button.danger {
    color: #fff;
    background: #c0392b;
    border-color: #c0392b;
  }
</style>
