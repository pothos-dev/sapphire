<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { backend } from '$lib/ipc';
  import { bundle } from '$lib/state/bundle.svelte';
  import { editor } from '$lib/state/editor.svelte';
  import { indexStore } from '$lib/state/index.svelte';
  import { session } from '$lib/state/session.svelte';
  import { suggestions } from '$lib/state/suggestions.svelte';
  import { theme } from '$lib/state/theme.svelte';
  import type { TreeNode } from '$lib/types';
  import {
    buildEditor,
    setEditorConcept,
    dispatchFrontmatter,
    refreshBrokenLinkDecorations,
    scrollToLine,
    openSearch,
  } from '$lib/editor/cm';
  import { undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
  import {
    splitFrontmatter,
    parseProperties,
    frontmatterLineCount,
    type Property,
  } from '$lib/frontmatter';
  import { resolveLink } from '$lib/links';
  import { isReservedFile, reservedKind, RESERVED_FILES, type ReservedKind } from '$lib/reserved';
  import Tree from '$lib/components/Tree.svelte';
  import TreeCrud from '$lib/components/TreeCrud.svelte';
  import QuickNav from '$lib/components/QuickNav.svelte';
  import SearchPanel from '$lib/components/SearchPanel.svelte';
  import Properties from '$lib/components/Properties.svelte';
  import Backlinks from '$lib/components/Backlinks.svelte';
  import Outline from '$lib/components/Outline.svelte';
  import TagBrowser from '$lib/components/TagBrowser.svelte';
  import SidebarSection from '$lib/components/SidebarSection.svelte';
  import { treeActions } from '$lib/state/treeActions.svelte';
  import { treeDnd } from '$lib/state/treeDnd.svelte';
  import { focus } from '$lib/state/focus.svelte';
  import { explorerNav } from '$lib/state/explorerNav.svelte';
  import { flattenVisible, neighborAfterRemoval } from '$lib/treeNav';
  import { outlineNav, backlinksNav } from '$lib/state/listFocusNav.svelte';
  import { propertiesNav } from '$lib/state/propertiesNav.svelte';
  import { region } from '$lib/region';
  import type { Direction } from '$lib/regionGrid';

  // Sidebar accordions (VSCode-style): the left Sidebar holds the Bundle tree
  // (Explorer) + Tags; the right Sidebar holds Backlinks (Outline arrives in a
  // later slice). Each expanded Section body is capped to its share of the
  // viewport — the cap is driven by `--expanded-count`, computed PER SIDEBAR so
  // each accordion divides its own height (see SidebarSection.svelte).
  //
  // All collapse state is persisted per-Bundle in the session store
  // (persist-sidebar-collapse-state / right-sidebar-move-backlinks): the
  // whole-sidebar collapse plus each Section's expanded flag survive a reload.
  // Reads come from the store's runes and toggles funnel through its setters,
  // which are gated on `restored` (a toggle firing mid-restore is a no-op
  // persistence-wise, so it can't clobber stored state — exactly how
  // `setExpanded` is guarded). Left Sections default to expanded for a fresh
  // Bundle; the right Sidebar starts COLLAPSED.
  // Right-Sidebar expanded count: only meaningful while the right Sidebar is
  // open. Sums its expanded Sections (Outline + Backlinks) so each body's cap
  // divides this sidebar's height independently of the left one.
  const rightExpandedCount = $derived(
    session.rightSidebarOpen
      ? (session.outlineOpen ? 1 : 0) + (session.backlinksOpen ? 1 : 0)
      : 0,
  );

  let editorParent = $state<HTMLDivElement | null>(null);
  let appRoot = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  // Disposer for the Editor Region's focus-backbone registration. The Editor's
  // entry point is the CodeMirror view itself (registered once it is built),
  // unlike the other Regions which use the `use:region` action on a container.
  let unregisterEditor: (() => void) | null = null;

  // The open Concept's frontmatter, mirrored out of the editor's frontmatter
  // field (the single source of truth — ADR 0003) so the Properties panel can
  // render it. Updated by the editor's `onFrontmatterChange` callback.
  let frontmatterProps = $state<Property[]>([]);

  // Unified undo/redo (unified-body-frontmatter-undo): one CodeMirror history
  // spans body + frontmatter. These mirror `undoDepth`/`redoDepth` so the
  // Properties-panel buttons can enable/disable reactively. They are NOT derived
  // from `view.state` (the view isn't reactive); instead `syncHistoryDepths` is
  // called from the editor's update listener (every transaction) and after any
  // programmatic undo/redo we trigger.
  let canUndo = $state(false);
  let canRedo = $state(false);
  function syncHistoryDepths() {
    canUndo = view ? undoDepth(view.state) > 0 : false;
    canRedo = view ? redoDepth(view.state) > 0 : false;
  }
  function doUndo() {
    if (!view) return;
    undo(view);
    view.focus();
    syncHistoryDepths();
  }
  function doRedo() {
    if (!view) return;
    redo(view);
    view.focus();
    syncHistoryDepths();
  }

  // Quick-nav palette (Ctrl+K). `quickNavOpen` toggles the overlay; the Concept
  // path list is refreshed from the index whenever it changes so newly-created
  // Concepts are matchable immediately.
  let quickNavOpen = $state(false);
  // Full-text search panel (Ctrl+Shift+F). When a result is chosen we open the
  // Concept and stash the target line so the editor scrolls to it once the new
  // document has been loaded into the CodeMirror view.
  let searchOpen = $state(false);
  let pendingScrollLine: number | null = null;

  // Index-derived autocomplete sources (Concept paths, `type`/key/tag values)
  // live in the `suggestions` store. Refresh them all whenever the index changes
  // (file-changed bumps `indexStore.version`) so newly-introduced
  // paths/types/keys/tags appear in suggestions immediately.
  $effect(() => {
    void indexStore.version;
    suggestions.refresh();
  });

  // The Tags Section is hidden entirely when the Bundle carries no tags
  // (hide-tags-section-when-empty) — an always-present empty Tags Section is
  // noise. `suggestions.tags` is reactive on the index `version` signal, so the
  // Section appears/disappears live as the first tag is added / last tag
  // removed. The persisted `tagsOpen` flag is left untouched while hidden
  // (gated render, no setter call), so it is preserved across hide/show. The
  // hidden Section is excluded from `expandedCount` (above) so the remaining
  // left-Sidebar Sections share height correctly.
  const tagsVisible = $derived(suggestions.tags.length > 0);
  // Left-Sidebar expanded count for the `--expanded-count` CSS var: count the
  // Explorer when open, and Tags only when it is BOTH present (tags exist) and
  // open — a hidden Tags Section must not steal a share of the height.
  const expandedCount = $derived(
    (session.explorerOpen ? 1 : 0) + (tagsVisible && session.tagsOpen ? 1 : 0),
  );

  // When a NEW Concept is created from the tree it opens focused on the `type`
  // field (the one the user must fill for OKF validity). This holds the path we
  // want focused; the Properties panel focuses `type` while it matches the open
  // Concept, then we clear it so ordinary navigation doesn't steal focus.
  let focusTypeForPath = $state<string | null>(null);
  const focusTypeNow = $derived(
    focusTypeForPath !== null && focusTypeForPath === editor.path,
  );

  /** Map an Alt-chord key to a Region-movement direction (arrows + hjkl), or
   *  null when the key isn't a movement key. */
  function regionDirection(key: string): Direction | null {
    switch (key) {
      case 'ArrowLeft':
      case 'h':
        return 'left';
      case 'ArrowDown':
      case 'j':
        return 'down';
      case 'ArrowUp':
      case 'k':
        return 'up';
      case 'ArrowRight':
      case 'l':
        return 'right';
      default:
        return null;
    }
  }

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

    // Mirror DOM focus into the `focus` store so the active Region can be styled
    // reactively and directional movement knows where it is (region-focus-backbone).
    const stopFocus = focus.start();

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
    // restyles created/removed targets. Sapphire's own autosave writes are
    // suppressed by the backend, so they never arrive here (no reload loop).
    const unsubscribe = backend.onFileChanged((change) => {
      void bundle.load();
      void editor.onExternalChange(change.kind, change.paths);
      void indexStore.refresh();
    });

    // Quick-nav palette: Ctrl+K (Cmd+K on macOS) toggles it. Checked before the
    // Alt-only history shortcuts below so it doesn't collide with them.
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        quickNavOpen = !quickNavOpen;
        return;
      }

      // Full-text search: Ctrl+Shift+F (Cmd+Shift+F on macOS). Requires Shift so
      // it doesn't collide with the (Cmd/Ctrl)+F editor find or other shortcuts.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchOpen = !searchOpen;
        return;
      }

      // In-Concept Find: Ctrl/Cmd+F (no Shift). App owns this binding so it grabs
      // focus from anywhere; we intercept, focus the editor, and open the
      // built-in find panel via the editor's exposed `openSearch`. NO-OP when no
      // Concept is open (no view / no path) — there is nothing to find in.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        if (!view || editor.path === null) return; // no Concept open: no-op.
        e.preventDefault();
        view.focus();
        openSearch(view);
        return;
      }

      // Unified undo/redo (unified-body-frontmatter-undo): route Ctrl/Cmd+Z,
      // Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y to the editor's history so undo works
      // even when focus is in a Properties <input> (outside the CodeMirror DOM).
      // When focus IS inside the editor we do nothing here and let CM's own
      // historyKeymap handle it natively (no double-handling).
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        const isUndo = key === 'z' && !e.shiftKey;
        const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
        if (isUndo || isRedo) {
          const inEditor = !!view && view.dom.contains(document.activeElement);
          if (inEditor) return; // CM's keymap handles it.
          e.preventDefault();
          if (isUndo) doUndo();
          else doRedo();
          return;
        }
      }

      // Browser-style history shortcuts moved to Ctrl+Alt+Left/Right
      // (Obsidian-style) so plain Alt+Left/Right is free for Region movement
      // (region-focus-backbone). Ctrl+Alt+arrow only — no Shift/Meta.
      if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          void editor.back();
          return;
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          void editor.forward();
          return;
        }
      }

      // Region movement: Alt+arrows AND Alt+hjkl move focus directionally across
      // the 3×2 Region grid (left/right change column, up/down move within it).
      // Plain Alt only — Ctrl+Alt is history (above), and we never touch
      // Ctrl+C/Ctrl+V (no Ctrl branch here). Escape returns to the Editor.
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Only when focus is inside a non-Editor Region (don't steal Escape from
        // overlays / inputs that handle it themselves and aren't in a Region).
        // Exception: while the Properties grid is in a deeper mode, Escape peels
        // exactly ONE layer locally and must not bubble up to the Region peel.
        // A list value cell has three depths: text-edit (`edit`) → chip sub-nav
        // (`chips`) → grid nav (`nav`). Both inner modes are handled locally (in
        // Properties / PropertyRow); the Region peel only applies once back in
        // nav mode (properties-grid-navigation, properties-chip-subnavigation).
        if (focus.focusedRegion === 'properties' && propertiesNav.mode !== 'nav') {
          return;
        }
        if (focus.focusedRegion !== null && focus.focusedRegion !== 'editor') {
          e.preventDefault();
          focus.escapeToEditor();
        }
        return;
      }

      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const dir = regionDirection(e.key);
      if (dir !== null) {
        e.preventDefault();
        focus.moveFocus(dir);
      }
    };
    // Capture phase so the palette shortcut wins even when focus is inside the
    // CodeMirror editor (whose keymap would otherwise swallow the event).
    window.addEventListener('keydown', onKeydown, true);

    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onKeydown, true);
      stopTheme();
      stopFocus();
      unregisterEditor?.();
      unregisterEditor = null;
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
    if (session.restored) {
      session.setLastOpenConcept(path);
      // Record every opened Concept in the per-Bundle recent-files list (used by
      // the quick-nav palette). Back/forward also funnel through `editor.path`,
      // so revisiting bumps a Concept back to the front (dedup in the store).
      if (path !== null) session.pushRecentFile(path);
    }
  });

  // Build / update the CodeMirror view whenever the open Concept content changes.
  // The editor holds only the BODY; the frontmatter is split off into the
  // editor's frontmatter field (ADR 0003). On a self-edit the recombined content
  // matches what the view already holds, so `setEditorConcept` is a no-op.
  $effect(() => {
    const content = editor.content;
    if (!editorParent) return;

    const { body } = splitFrontmatter(content);
    const props = parseProperties(content);

    if (!view) {
      view = buildEditor({
        parent: editorParent,
        doc: body,
        frontmatter: props,
        path: editor.path,
        readOnly: false,
        onChange: (full) => editor.edit(full),
        onFrontmatterChange: (p) => (frontmatterProps = p),
        onBlur: () => void editor.flush(),
        onHistory: syncHistoryDepths,
        onLinkClick: handleLinkClick,
        brokenLinkContext: {
          currentPath: () => editor.path ?? '',
          exists: (path) => indexStore.exists(path),
        },
      });
      frontmatterProps = props;
      syncHistoryDepths();
      // Register the Editor Region with the focus backbone. Its entry point is
      // the CodeMirror view (home base for Escape + the grid's centre column).
      // Visible only when a Concept is open (the editor-host is hidden otherwise).
      unregisterEditor = focus.register('editor', {
        container: view.dom,
        focus: () => {
          view?.focus();
          return true;
        },
        isVisible: () => editor.path !== null,
      });
    } else {
      // No-op when body + frontmatter are unchanged (guards against feedback
      // from edits); updates the field on Concept switch / external reload. A
      // path change triggers a state rebuild (fresh, empty history) so undo
      // cannot cross the Concept boundary.
      setEditorConcept(view, body, props, editor.path);
    }

    // Full-text search: after the matching Concept's document is in the view,
    // scroll to (and place the cursor on) the matched line, then clear the
    // request so ordinary edits don't re-scroll. Runs in this effect because it
    // must happen AFTER the doc replacement above.
    if (pendingScrollLine !== null && view) {
      scrollToLine(view, pendingScrollLine);
      pendingScrollLine = null;
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
    // Plain navigation cancels any pending "focus type" request from a create.
    focusTypeForPath = null;
    void editor.open(path);
  }

  // The Explorer's tree-pane element (the `explorer` Region container). Used to
  // drive DOM focus onto the Focused-item row as the keyboard cursor moves, so
  // the region backbone's sticky last-item memory and the active-Region mirror
  // both track it.
  let treePane = $state<HTMLDivElement | null>(null);

  // Within-Region keyboard navigation for the Explorer (explorer-keyboard-nav).
  // Cross-Region movement (Alt+dir) + Escape→Editor stay in the global capture
  // handler in onMount; THIS handles the unmodified arrow/hjkl/Enter/Home/End
  // keys LOCALLY on the tree-pane. The store moves the Focused item (a tree row)
  // independently of the open Concept; an effect below mirrors it into DOM focus.
  function onTreeKeydown(e: KeyboardEvent) {
    const handled = explorerNav.handleKeydown(e, bundle.tree, {
      isExpanded: (p) => session.isExpanded(p),
      setExpanded: (p, open) => session.setExpanded(p, open),
      openConcept: openConceptFromTree,
    });
    if (handled) {
      e.preventDefault();
      return;
    }
    // CRUD letter keys (slice: explorer-crud-keybindings): r/F2, d/Delete, a,
    // A (Shift+a), m fire the existing TreeCrud dialogs on the Focused item.
    // Never fire while typing in a text input (the dialogs' own fields sit
    // OUTSIDE this tree-pane handler, but guard defensively all the same).
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) {
      return;
    }
    const crudHandled = explorerNav.handleCrudKeydown(e, {
      rename: (p) => treeCrud?.requestRename(p),
      remove: (p) => {
        // Pre-resolve the neighbour to land on AFTER the delete, while the tree
        // is still current (the row vanishes once the delete commits).
        const rows = flattenVisible(bundle.tree, (q) => session.isExpanded(q));
        pendingDeleteNeighbor = neighborAfterRemoval(rows, p);
        treeCrud?.requestDelete(p);
      },
      newConcept: (p) => treeCrud?.requestNewConcept(p),
      newFolder: (p) => treeCrud?.requestNewFolder(p),
      move: (p) => treeCrud?.requestMove(p),
    });
    if (crudHandled) e.preventDefault();
  }

  // The Focused-item row to restore to when a keyboard-triggered CRUD dialog is
  // cancelled (the Explorer's cursor at open time), and the neighbour to land on
  // after a delete commits (resolved before the row vanishes). See the TreeCrud
  // `oncommit`/`oncancel` wiring below.
  let pendingDeleteNeighbor = $state<string | null>(null);

  // Return focus to the Explorer with `path` as the Focused item — used after a
  // CRUD dialog commits (the affected node becomes the cursor) so create/rename/
  // move/delete all end with the keyboard back in the tree on a sensible row.
  function refocusExplorerAt(path: string | null) {
    if (path !== null) explorerNav.setFocused(path);
    // The affected row may not be in the DOM yet — a create/rename/move awaits a
    // backend round-trip and a `bundle.load()`, whose reactive re-render lands a
    // frame or two later. Retry across a few animation frames until the row
    // exists, then focus it: focusing a row inside the Explorer container makes
    // it the active Region (the focus mirror picks it up) and the Focused item.
    let tries = 0;
    const tryFocus = () => {
      const target = explorerNav.focusedPath;
      if (target === null || !treePane) return;
      const row = treePane.querySelector<HTMLElement>(
        `.row[data-row-path="${CSS.escape(target)}"]`,
      );
      if (row) {
        row.focus();
      } else if (tries++ < 10) {
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }

  function onCrudCommit(path: string, opts?: { deleted?: boolean }) {
    if (opts?.deleted) {
      refocusExplorerAt(pendingDeleteNeighbor);
      pendingDeleteNeighbor = null;
    } else {
      refocusExplorerAt(path);
    }
  }

  function onCrudCancel() {
    // Restore focus to the Explorer at the row that was focused when the dialog
    // opened (the current `focusedPath` is unchanged by opening a dialog).
    refocusExplorerAt(explorerNav.focusedPath);
    pendingDeleteNeighbor = null;
  }

  // Enter on a file row: open the Concept AND move focus to the Editor (the
  // Focused item and the open Concept coincide here, then diverge if the user
  // arrows back into the tree). Routes through the same `editor.open` navigation
  // path as a click, then focuses the CodeMirror view once it has the document.
  function openConceptFromTree(path: string) {
    openConcept(path);
    // Focus the Editor after the open settles. `editor.open` is async and the
    // view updates reactively; a microtask defer lets the build/update effect
    // run first so `view` points at the new Concept before we focus it.
    queueMicrotask(() => view?.focus());
  }

  // Focus the CodeMirror view once it exists. Used when opening a Concept from a
  // Region with NOTHING open yet (e.g. Enter on a Tags concept leaf on a fresh
  // load): `view` is null until the build effect runs, so a single microtask is
  // too early. Retry across a few animation frames until the view is built.
  function focusEditorWhenReady() {
    let tries = 0;
    const tryFocus = () => {
      if (view) {
        view.focus();
      } else if (tries++ < 10) {
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }

  // Mirror the Focused-item path into DOM focus: when the keyboard cursor moves
  // (arrowing, Home/End, parent-jump), focus the matching row element so the
  // region backbone records it as the Explorer's remembered item and the
  // active-Region highlight tracks it. Only acts while the Explorer holds focus
  // (so a click elsewhere or a programmatic path change can't steal focus).
  $effect(() => {
    const path = explorerNav.focusedPath;
    if (path === null || !treePane) return;
    if (focus.focusedRegion !== 'explorer') return;
    const row = treePane.querySelector<HTMLElement>(
      `.row[data-row-path="${CSS.escape(path)}"]`,
    );
    if (row && document.activeElement !== row) row.focus();
  });

  // --- Outline & Backlinks within-Region keyboard navigation
  // (outline-backlinks-keyboard-nav). Same shape as the Explorer above: a LOCAL
  // onkeydown on each Region container routes the unmodified arrow/jk/Enter/Home/
  // End keys to a flat-list nav store (`$lib/state/listFocusNav`), and an effect
  // mirrors the store's Focused index into DOM focus while that Region is active.
  // Cross-Region movement (Alt+dir) + Escape→Editor stay in the global handler.
  let outlineHost = $state<HTMLDivElement | null>(null);
  let backlinksHost = $state<HTMLDivElement | null>(null);

  // Outline Enter: scroll the Editor to the heading (same path as a click) AND
  // move focus to the Editor. The entry's full-document line rides on its
  // rendered button's `data-line`, so we read it from the DOM rather than
  // re-deriving the heading list here.
  function onOutlineKeydown(e: KeyboardEvent) {
    if (!outlineHost) return;
    const count = outlineHost.querySelectorAll('[data-testid="outline-entry"]').length;
    const handled = outlineNav.handleKeydown(e, count, (index) => {
      const entry = outlineHost?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      const line = entry ? Number(entry.dataset.line) : NaN;
      if (Number.isFinite(line)) {
        scrollToOutlineLine(line);
        queueMicrotask(() => view?.focus());
      }
    });
    if (handled) e.preventDefault();
  }

  // Backlinks Enter: open the linked Concept (routes through navigation/history,
  // focus → Editor), exactly like clicking it. The source path rides on the
  // rendered button's `data-path`.
  function onBacklinksKeydown(e: KeyboardEvent) {
    if (!backlinksHost) return;
    const count = backlinksHost.querySelectorAll('[data-testid="backlink"]').length;
    const handled = backlinksNav.handleKeydown(e, count, (index) => {
      const entry = backlinksHost?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      const source = entry?.dataset.path;
      if (source) {
        openConcept(source);
        queueMicrotask(() => view?.focus());
      }
    });
    if (handled) e.preventDefault();
  }

  // Mirror the Outline Focused index into DOM focus while the Outline holds
  // focus, so the region backbone records its remembered item and the active-
  // Region highlight tracks it. Mirrors the Explorer effect above.
  $effect(() => {
    const index = outlineNav.focusedIndex;
    if (index === null || !outlineHost) return;
    if (focus.focusedRegion !== 'outline') return;
    const entry = outlineHost.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (entry && document.activeElement !== entry) entry.focus();
  });

  // Mirror the Backlinks Focused index into DOM focus while Backlinks holds focus.
  $effect(() => {
    const index = backlinksNav.focusedIndex;
    if (index === null || !backlinksHost) return;
    if (focus.focusedRegion !== 'backlinks') return;
    const entry = backlinksHost.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (entry && document.activeElement !== entry) entry.focus();
  });

  // Open a full-text search result: navigate to the Concept (through history),
  // then scroll the editor to the matched line. We stash the line and let the
  // editor-build $effect apply the scroll once the new document is loaded, so
  // the scroll lands AFTER the doc replacement. Re-running search on the same
  // open Concept (path unchanged) still scrolls: `editor.open` is a no-op then,
  // so apply the scroll directly to the current view.
  function openSearchResult(path: string, line: number) {
    focusTypeForPath = null;
    if (editor.path === path) {
      if (view) scrollToLine(view, line);
    } else {
      pendingScrollLine = line;
      void editor.open(path);
    }
  }

  // Outline navigation (outline-section): scroll the editor to a heading's line
  // when its Outline entry is clicked. The Outline tracks line numbers against
  // the FULL document (frontmatter included) so the entry is unambiguous, but
  // the CodeMirror view holds only the BODY (frontmatter is split off, ADR
  // 0003). So convert the full-document line to a body-relative line by
  // subtracting the frontmatter block's line count before scrolling.
  function scrollToOutlineLine(line: number) {
    if (!view) return;
    scrollToLine(view, line - frontmatterLineCount(editor.content));
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

  // A frontmatter property edit: dispatch the new properties into the editor's
  // frontmatter field. The editor's change listener recombines `serialize(props)
  // + body` and routes it through `editor.edit` (autosave); we then flush so
  // frontmatter edits persist immediately (matching the prior behavior).
  function onPropertiesChange(props: Property[]) {
    if (!view) return;
    // Dispatch as a discrete, isolated history step so each committed
    // frontmatter action is its own undo step and never coalesces with body
    // typing (unified-body-frontmatter-undo).
    dispatchFrontmatter(view, props);
    void editor.flush();
  }

  // --- Tree CRUD: context menu + dialogs (slice: tree-crud) ---
  // The menu + dialogs live in TreeCrud.svelte; App keeps a reference so the
  // tree rows / root affordances can open the menu via its exported `openMenu`,
  // and binds `focusTypeForPath` so create-concept/create-reserved can drive the
  // focus-the-type request App owns (see the focus-type comment above).
  let treeCrud = $state<ReturnType<typeof TreeCrud> | null>(null);
  function openMenu(node: TreeNode, x: number, y: number) {
    treeCrud?.openMenu(node, x, y);
  }

  // The Bundle root is rendered here directly (not via <Tree/>), so its own
  // reserved-file handling lives here: strip reserved files from the root leaf
  // listing and surface them as affordances on a root header row (slice:
  // reserved-files — index.md can appear at ANY level, including the root).
  const rootChildren = $derived(bundle.tree?.children ?? []);
  const rootOrdinary = $derived(
    rootChildren.filter(
      (c) => c.isDir || (c.name.toLowerCase().endsWith('.md') && !isReservedFile(c.path)),
    ),
  );
  const rootReserved = $derived(
    rootChildren
      .filter((c) => !c.isDir && isReservedFile(c.path))
      .map((c) => ({ path: c.path, kind: reservedKind(c.path) as ReservedKind })),
  );
  const ROOT_RESERVED_ORDER: ReservedKind[] = ['index', 'log'];
  const rootReservedSorted = $derived(
    [...rootReserved].sort(
      (a, b) => ROOT_RESERVED_ORDER.indexOf(a.kind) - ROOT_RESERVED_ORDER.indexOf(b.kind),
    ),
  );
  const ROOT_RESERVED_GLYPH: Record<ReservedKind, string> = { index: '☰', log: '🕑' };

  // Auto-dismiss the link-rewrite notice a few seconds after it appears. Keyed
  // on the notice `id` so each new move restarts the timer (and re-shows even an
  // identical message). Kept unobtrusive — it never blocks interaction.
  $effect(() => {
    const notice = treeActions.notice;
    if (notice === null) return;
    const timer = setTimeout(() => treeActions.dismissNotice(), 4000);
    return () => clearTimeout(timer);
  });
</script>

<div
  class="app"
  class:sidebar-collapsed={!session.leftSidebarOpen}
  data-testid="app-root"
  bind:this={appRoot}
>
  <aside
    class="side-bar"
    aria-label="Sidebar"
    data-testid="side-bar"
    style="--expanded-count: {expandedCount}"
  >
    <!-- Fixed-width inner, anchored to the sidebar's right edge (the aside uses
         `justify-content: flex-end`). When the aside's width animates to 0 the
         inner keeps its width and slides out to the left, clipped by the aside's
         `overflow: hidden` — a clean slide rather than a content squish. -->
    <div class="side-bar-inner">
    <SidebarSection
      title="Explorer"
      expanded={session.explorerOpen}
      ontoggle={() => session.setExplorerOpen(!session.explorerOpen)}
      testid="explorer-section"
    >
      {#snippet actions()}
        {#if rootReservedSorted.length > 0}
          <!-- Bundle-root reserved files (index.md / log.md) surface as icon
               buttons on the Explorer header rather than as tree rows, so the
               root listing shows only ordinary Concepts and folders. -->
          <div class="root-reserved" data-testid="root-reserved">
            {#each rootReservedSorted as r (r.path)}
              <button
                type="button"
                class="reserved-btn"
                class:selected={editor.path === r.path}
                title={`Open ${RESERVED_FILES[r.kind]} (Bundle root)`}
                aria-label={`Open ${RESERVED_FILES[r.kind]}`}
                data-reserved-path={r.path}
                data-reserved-kind={r.kind}
                onclick={() => openConcept(r.path)}
              >{ROOT_RESERVED_GLYPH[r.kind]}</button>
            {/each}
          </div>
        {/if}
      {/snippet}
      <!-- The pane (not just the row list) is the Bundle-root drop zone, so the
           empty space below the rows is droppable. Folder/file rows stopPropagation
           on their own drags, so any drag event reaching here is over bare space
           and resolves to "move to the Bundle root". -->
      <div
        class="tree-pane"
        class:drop-target={treeDnd.dropTarget === ''}
        class:region-active={focus.focusedRegion === 'explorer'}
        data-region="explorer"
        bind:this={treePane}
        use:region={{ id: 'explorer', isVisible: () => session.explorerOpen }}
        onkeydown={onTreeKeydown}
        ondragover={(e) => {
          const from = treeDnd.dragging;
          if (from === null || !treeDnd.canDrop(from, '')) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          treeDnd.dropTarget = '';
        }}
        ondragleave={(e) => {
          if (
            e.currentTarget instanceof Node &&
            e.relatedTarget instanceof Node &&
            e.currentTarget.contains(e.relatedTarget)
          )
            return;
          if (treeDnd.dropTarget === '') treeDnd.dropTarget = null;
        }}
        ondrop={(e) => {
          e.preventDefault();
          const from = treeDnd.dragging;
          treeDnd.end();
          if (from !== null && treeDnd.canDrop(from, '')) void treeActions.movePath(from, '');
        }}
        role="presentation"
      >
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
        {#each rootOrdinary as child (child.path)}
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
      </div>
    </SidebarSection>

    <!-- Tags lives in the left Sidebar (Backlinks moved to the right Sidebar).
         It refreshes via the shared index `version` signal (bumped on every
         file-changed) — the same mechanism the broken-link cache uses, so no
         bespoke refresh path. Selecting an entry routes through `openConcept`
         (editor navigation) for back/forward history. -->
    {#if tagsVisible}
      <SidebarSection
        title="Tags"
        expanded={session.tagsOpen}
        ontoggle={() => session.setTagsOpen(!session.tagsOpen)}
        testid="tags-section"
      >
        <div
          class="region-host"
          class:region-active={focus.focusedRegion === 'tags'}
          data-region="tags"
          use:region={{ id: 'tags', isVisible: () => tagsVisible && session.tagsOpen }}
        >
          <TagBrowser
            version={indexStore.version}
            selected={editor.path}
            onopen={openConcept}
            onopenFocus={(p) => {
              // Keyboard Enter on a concept leaf: open AND move focus to the
              // Editor (CONTEXT.md). `editor.open` is async and the view is
              // (re)built in a reactive effect a frame or two later — and when
              // NO Concept was open yet, `view` is still null at the next
              // microtask. So retry focusing across a few frames until the view
              // exists, mirroring the Explorer's post-CRUD refocus.
              openConcept(p);
              focusEditorWhenReady();
            }}
          />
        </div>
      </SidebarSection>
    {/if}
    </div>
  </aside>

  <main class="editor-pane" aria-label="Concept">
    <nav class="nav-bar" aria-label="Navigation history">
      <div class="nav-left">
        <button
          type="button"
          class="nav-btn"
          data-testid="sidebar-toggle"
          title={session.leftSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={session.leftSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-pressed={session.leftSidebarOpen}
          onclick={() => session.setLeftSidebarOpen(!session.leftSidebarOpen)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <rect
              x="1.5"
              y="2.5"
              width="13"
              height="11"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
            <line
              x1="6"
              y1="2.5"
              x2="6"
              y2="13.5"
              stroke="currentColor"
              stroke-width="1.2"
            />
            <rect
              x="1.5"
              y="2.5"
              width="4.5"
              height="11"
              rx="1.5"
              fill="currentColor"
              opacity={session.leftSidebarOpen ? 0.5 : 0}
              stroke="none"
            />
          </svg>
        </button>
      </div>
      <div class="nav-center">
        <button
          type="button"
          class="nav-btn"
          data-testid="nav-back"
          title="Back (Ctrl+Alt+Left)"
          aria-label="Back"
          disabled={!editor.canGoBack}
          onclick={() => void editor.back()}>←</button
        >
        <button
          type="button"
          class="nav-btn"
          data-testid="nav-forward"
          title="Forward (Ctrl+Alt+Right)"
          aria-label="Forward"
          disabled={!editor.canGoForward}
          onclick={() => void editor.forward()}>→</button
        >
      </div>
      <div class="nav-right">
        <button
          type="button"
          class="nav-btn"
          data-testid="right-sidebar-toggle"
          title={session.rightSidebarOpen
            ? 'Collapse Outline & Backlinks'
            : 'Expand Outline & Backlinks'}
          aria-label={session.rightSidebarOpen
            ? 'Collapse Outline & Backlinks'
            : 'Expand Outline & Backlinks'}
          aria-pressed={session.rightSidebarOpen}
          onclick={() => session.setRightSidebarOpen(!session.rightSidebarOpen)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <rect
              x="1.5"
              y="2.5"
              width="13"
              height="11"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
            <line
              x1="10"
              y1="2.5"
              x2="10"
              y2="13.5"
              stroke="currentColor"
              stroke-width="1.2"
            />
            <rect
              x="10"
              y="2.5"
              width="4.5"
              height="11"
              rx="1.5"
              fill="currentColor"
              opacity={session.rightSidebarOpen ? 0.5 : 0}
              stroke="none"
            />
          </svg>
        </button>
      </div>
    </nav>
    {#if editor.error}
      <p class="status error">{editor.error}</p>
    {/if}
    {#if !editor.path && !editor.error}
      <p class="placeholder" data-testid="placeholder">Select a Concept from the tree.</p>
    {/if}
    {#if editor.path && !isReservedFile(editor.path)}
      <div
        class="region-host properties-host"
        class:region-active={focus.focusedRegion === 'properties'}
        data-region="properties"
        use:region={{
          id: 'properties',
          isVisible: () => editor.path !== null && !isReservedFile(editor.path),
        }}
      >
        <Properties
          properties={frontmatterProps}
          path={editor.path}
          types={suggestions.types}
          keys={suggestions.keys}
          tags={suggestions.tags}
          focusType={focusTypeNow}
          onchange={onPropertiesChange}
          onUndo={doUndo}
          onRedo={doRedo}
          {canUndo}
          {canRedo}
        />
      </div>
    {/if}
    <div
      class="editor-host"
      class:hidden={!editor.path}
      class:region-active={focus.focusedRegion === 'editor'}
      data-region="editor"
      data-testid="editor"
      bind:this={editorParent}
    ></div>
  </main>

  <!-- Right Sidebar: a second accordion mirroring the left one, anchored so its
       fixed-width inner stays flush to the LEFT and slides out to the RIGHT edge
       when the aside's width animates to 0 (the aside uses default
       `justify-content: flex-start` and clips with `overflow: hidden`). It holds
       the Outline + Backlinks Sections and starts COLLAPSED. Its
       `--expanded-count` is its own (Outline + Backlinks), so the body cap
       divides this sidebar's height independently of the left one. -->
  <aside
    class="side-bar right-side-bar"
    class:collapsed={!session.rightSidebarOpen}
    aria-label="Outline & Backlinks"
    data-testid="right-side-bar"
    style="--expanded-count: {rightExpandedCount}"
  >
    <div class="side-bar-inner">
      <SidebarSection
        title="Outline"
        expanded={session.outlineOpen}
        ontoggle={() => session.setOutlineOpen(!session.outlineOpen)}
        testid="outline-section"
      >
        <div
          class="region-host"
          class:region-active={focus.focusedRegion === 'outline'}
          data-region="outline"
          bind:this={outlineHost}
          use:region={{
            id: 'outline',
            isVisible: () => session.rightSidebarOpen && session.outlineOpen && editor.path !== null,
          }}
          onkeydown={onOutlineKeydown}
          role="presentation"
        >
          <Outline path={editor.path} content={editor.content} onselect={scrollToOutlineLine} />
        </div>
      </SidebarSection>
      <SidebarSection
        title="Backlinks"
        expanded={session.backlinksOpen}
        ontoggle={() => session.setBacklinksOpen(!session.backlinksOpen)}
        testid="backlinks-section"
      >
        <div
          class="region-host"
          class:region-active={focus.focusedRegion === 'backlinks'}
          data-region="backlinks"
          bind:this={backlinksHost}
          use:region={{
            id: 'backlinks',
            isVisible: () =>
              session.rightSidebarOpen && session.backlinksOpen && editor.path !== null,
          }}
          onkeydown={onBacklinksKeydown}
          role="presentation"
        >
          <Backlinks path={editor.path} version={indexStore.version} onopen={openConcept} />
        </div>
      </SidebarSection>
    </div>
  </aside>

  <QuickNav
    open={quickNavOpen}
    paths={suggestions.conceptPaths}
    recent={session.recentFiles}
    onopen={openConcept}
    onclose={() => (quickNavOpen = false)}
  />

  <SearchPanel
    open={searchOpen}
    onopen={openSearchResult}
    onclose={() => (searchOpen = false)}
  />

  <TreeCrud
    bind:this={treeCrud}
    bind:focusTypeForPath
    oncommit={onCrudCommit}
    oncancel={onCrudCancel}
  />

  {#if treeActions.notice}
    <div class="toast" role="status" aria-live="polite" data-testid="rewrite-toast">
      {treeActions.notice.message}
    </div>
  {/if}
</div>

<style>
  /* Theme is driven by `data-theme` on the app root (set by the theme store,
     state/theme.svelte.ts — OS-driven default). The attribute selects the token
     block in app.css; the app UI and atomic-editor both read from it, so they
     stay consistent. Base resets + the body typeface live in app.css. */
  /* Three tracks: left Sidebar | editor pane | right Sidebar. The outer `auto`
     tracks follow each sidebar's own width. Collapsing animates that width to 0
     (see `.side-bar`); the `auto` track shrinks with it and the `1fr` editor
     pane expands to fill the gap. We animate `width` rather than
     `grid-template-columns` because the latter doesn't interpolate in the
     WebKitGTK webview Tauri uses on Linux. */
  .app {
    display: grid;
    grid-template-columns: auto 1fr auto;
    height: 100vh;
    overflow: hidden;
    color: var(--text);
    background: var(--bg);
  }

  /* Left sidebar: a fixed-width box clipping a vertical stack of collapsible
     accordion sections. The inner stack (`.side-bar-inner`) holds the flex
     column; the aside itself is just the animated, clipping frame. */
  .side-bar {
    width: 280px;
    height: 100vh;
    overflow: hidden;
    display: flex;
    justify-content: flex-end;
    border-right: 1px solid var(--border);
    background: var(--bg-elevated);
    transition: width 0.22s ease;
  }

  .app.sidebar-collapsed .side-bar {
    width: 0;
    border-right-width: 0;
  }

  /* Right Sidebar: mirrors the left one but borders on its LEFT edge and anchors
     its inner stack to the LEFT (flex-start, the default) so the content slides
     out to the right edge as the aside's width animates to 0. */
  .right-side-bar {
    justify-content: flex-start;
    border-right: none;
    border-left: 1px solid var(--border);
  }

  .right-side-bar.collapsed {
    width: 0;
    border-left-width: 0;
  }

  .side-bar-inner {
    flex: none;
    width: 280px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: 0.9rem;
  }

  /* Padding wrapper for the tree inside the Explorer section body. */
  .tree-pane {
    padding: 0.5rem;
  }

  /* Active-Region affordance (region-focus-backbone): the Region currently
     holding keyboard focus gets a SUBTLE lighter background on its container.
     Deliberately no ring/border around the Region — the Focused item's own
     `:focus-visible` ring stays the prominent spotlight. Driven by the
     `focusedRegion` rune (state/focus.svelte.ts), which mirrors DOM focus.
     The Region containers focused via `use:region` carry tabindex=-1 as a
     fallback entry point; suppress the default outline on them so only the
     subtle background reads as the Region affordance. */
  .region-active {
    background: var(--hover);
  }

  .region-host:focus,
  .tree-pane:focus,
  .editor-host:focus {
    outline: none;
  }

  /* A plain block wrapper that hosts a Region container (Tags / Properties /
     Outline / Backlinks) so the active-Region background paints behind the
     whole Section body. */
  .region-host {
    display: block;
  }

  /* Whole-pane highlight while a row is dragged over empty space (drop = move to
     the Bundle root). */
  .tree-pane.drop-target {
    box-shadow: inset 0 0 0 1px var(--accent-ring);
    border-radius: var(--radius-sm);
  }

  .editor-pane {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  /* Three-track header: the toggle sits at the left, the back/forward group is
     centred in the pane regardless of the toggle's width (empty right track
     balances the left). */
  .nav-bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  .nav-left {
    justify-self: start;
  }

  .nav-center {
    display: flex;
    gap: 0.35rem;
    justify-self: center;
  }

  .nav-right {
    justify-self: end;
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    line-height: 1;
    transition: background 0.12s ease;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--hover);
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

  /* Breathing room on both sides of the editor column. The atomic-editor
     package injects `.cm-content { padding: 0 }` via a CodeMirror theme
     (specificity `(0,2,0)` — a generated wrapper class scoping `.cm-content`).
     We match `.cm-editor .cm-content` (specificity `(0,3,0)`) so this
     `padding-inline` longhand wins over the theme's `padding` shorthand. */
  .editor-host :global(.cm-editor .cm-content) {
    padding-inline: 1.5rem;
  }

  .placeholder,
  .status {
    padding: 1rem;
    color: var(--text-muted);
  }

  .status.error {
    color: var(--danger);
  }

  /* Unobtrusive bottom-centre toast: confirms auto-rewritten links after a
     move without blocking interaction. Auto-dismisses (see the $effect). */
  .toast {
    position: fixed;
    bottom: 1.25rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    padding: 0.55rem 0.95rem;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 0.82rem;
    font-weight: 600;
    box-shadow: var(--shadow-md);
    pointer-events: none;
  }

  /* Bundle-root reserved files live in the Explorer header (see SidebarSection
     `actions`): compact, icon-only buttons. */
  .root-reserved {
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }

  .reserved-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.75;
    transition: background 0.12s ease;
  }

  .reserved-btn:hover {
    background: var(--hover);
    opacity: 1;
  }

  .reserved-btn:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: -1px;
    opacity: 1;
  }

  .reserved-btn.selected {
    background: var(--accent-soft);
    color: var(--tag-text);
    opacity: 1;
  }

  .root-new {
    margin: 0.3rem 0.1rem;
    padding: 0.25rem 0.6rem;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    opacity: 0.8;
    transition: background 0.12s ease;
  }

  .root-new:hover {
    background: var(--hover);
    opacity: 1;
  }
</style>
