<script lang="ts">
  // Per-Pane header (slice: per-tile-header). A slim strip above the Editor
  // carrying everything that is logically PER-PANE for the active Concept:
  //   - the Concept title + a close affordance (clears the Pane to empty state),
  //   - Split Right / Split Down affordances (wired but no-ops until ticket 03),
  //   - the tri-state view-mode toggle (Source / Live / Reading),
  //   - undo / redo over the active Pane's Document history,
  //   - the review-diff toggle (working-tree ↔ HEAD),
  //   - Export as PDF.
  //
  // Presentational and thin: it owns no state. All logic (mode switching, undo/
  // redo, review, export, close, split) lives in App.svelte and is passed in as
  // callbacks + reactive flags, mirroring how the NavBar (global chrome) works.
  import type { EditorMode } from '$lib/editor/cm';

  interface Props {
    /** The active Concept's derived header label ('' when the Pane is empty). */
    title: string;
    /** Whether a Concept is open (gates the per-Concept controls). */
    hasOpenConcept: boolean;
    /** Whether there is a previous / next Concept in the Pane's history. */
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
    /** The Pane's current view mode (Source / Live / Reading). */
    editorMode: EditorMode;
    /** Undo/redo availability over the Pane's Document (body+frontmatter) history. */
    canUndo: boolean;
    canRedo: boolean;
    /** Whether the Concept is currently in review (working-tree ↔ HEAD) mode. */
    reviewActive: boolean;
    /** Whether the review toggle is available (the file has reviewable history). */
    reviewEnabled: boolean;
    /** Tooltip for the review toggle (explains the disabled reason when disabled). */
    reviewTooltip: string;
    /** Clear the Pane to its empty state. */
    onClose: () => void;
    /** Split the Pane to the right (no-op until ticket 03). */
    onSplitRight: () => void;
    /** Split the Pane downward (no-op until ticket 03). */
    onSplitDown: () => void;
    onSetMode: (mode: EditorMode) => void;
    onUndo: () => void;
    onRedo: () => void;
    onToggleReview: () => void;
    onExportPdf: () => void;
  }

  let {
    title,
    hasOpenConcept,
    canGoBack,
    canGoForward,
    onBack,
    onForward,
    editorMode,
    canUndo,
    canRedo,
    reviewActive,
    reviewEnabled,
    reviewTooltip,
    onClose,
    onSplitRight,
    onSplitDown,
    onSetMode,
    onUndo,
    onRedo,
    onToggleReview,
    onExportPdf,
  }: Props = $props();

  // Display-only data for the mode toggle; the mode state + switch logic live in
  // App.svelte (moved here from the NavBar — it is a per-Pane control).
  const EDITOR_MODES: { mode: EditorMode; label: string; title: string }[] = [
    { mode: 'edit', label: 'Source', title: 'Source — raw markdown' },
    { mode: 'hybrid', label: 'Live', title: 'Live preview — render with the cursor line shown raw' },
    { mode: 'view', label: 'Read', title: 'Reading view — fully rendered, read-only' },
  ];
</script>

<header class="pane-header" data-testid="pane-header" aria-label="Concept header">
  <div class="pane-title-group">
    <!-- Per-Pane navigation history (the Pane owns its own Back/Forward stack). -->
    <div class="btn-group">
      <button
        type="button"
        class="icon-btn"
        data-testid="nav-back"
        title="Back (Ctrl+Alt+Left)"
        aria-label="Back"
        disabled={!canGoBack}
        onclick={onBack}>←</button
      >
      <button
        type="button"
        class="icon-btn"
        data-testid="nav-forward"
        title="Forward (Ctrl+Alt+Right)"
        aria-label="Forward"
        disabled={!canGoForward}
        onclick={onForward}>→</button
      >
    </div>
    <span class="pane-title" data-testid="pane-title" title={title}>{title}</span>
    <button
      type="button"
      class="icon-btn"
      data-testid="pane-close"
      title="Close Concept"
      aria-label="Close Concept"
      disabled={!hasOpenConcept}
      onclick={onClose}>×</button
    >
  </div>

  <div class="pane-controls">
    <!-- Tri-state view mode (moved from the NavBar): Source / Live / Reading. -->
    <div
      class="mode-toggle"
      role="group"
      aria-label="Editor mode"
      data-testid="editor-mode-toggle"
    >
      {#each EDITOR_MODES as m (m.mode)}
        <button
          type="button"
          class="mode-btn"
          class:active={editorMode === m.mode}
          data-testid={`editor-mode-${m.mode}`}
          title={m.title}
          aria-label={m.title}
          aria-pressed={editorMode === m.mode}
          disabled={!hasOpenConcept}
          onclick={() => onSetMode(m.mode)}>{m.label}</button
        >
      {/each}
    </div>

    <!-- Undo / redo over the Pane's single body+frontmatter history. Decoupled
         from the Properties panel (they rode there by historical accident). The
         mousedown-prevent keeps clicking a button from blurring/committing an
         in-progress frontmatter edit before the command runs. -->
    <div class="btn-group">
      <button
        type="button"
        class="icon-btn"
        data-testid="undo"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        disabled={!canUndo}
        onmousedown={(e) => e.preventDefault()}
        onclick={onUndo}>↶</button
      >
      <button
        type="button"
        class="icon-btn"
        data-testid="redo"
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        disabled={!canRedo}
        onmousedown={(e) => e.preventDefault()}
        onclick={onRedo}>↷</button
      >
    </div>

    <!-- Review changes (working-tree ↔ HEAD): a read-only diff view. Disabled
         with an explanatory tooltip when the Concept has no reviewable history. -->
    <button
      type="button"
      class="icon-btn"
      class:active={reviewActive}
      data-testid="review-toggle"
      title={reviewTooltip}
      aria-label={reviewTooltip}
      aria-pressed={reviewActive}
      disabled={!hasOpenConcept || !reviewEnabled}
      onclick={onToggleReview}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <!-- git-branch glyph: two commit nodes on a branch line + a fork. -->
        <circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2" />
        <circle cx="4" cy="13" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2" />
        <circle cx="12" cy="5.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2" />
        <line x1="4" y1="4.6" x2="4" y2="11.4" stroke="currentColor" stroke-width="1.2" />
        <path d="M4 8.5 Q4 5.5 10.4 5.5" fill="none" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>

    <!-- Export as PDF: render the Concept to static HTML in a clean preview
         window (App.svelte's `exportPdf`), not the virtualized editor. -->
    <button
      type="button"
      class="icon-btn"
      data-testid="export-pdf"
      title="Export as PDF"
      aria-label="Export as PDF"
      disabled={!hasOpenConcept}
      onclick={onExportPdf}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path
          d="M4 2.5h5l3 3v8a0 0 0 0 1 0 0H4a0 0 0 0 1 0 0z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
        <path d="M9 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
        <path
          d="M8 7.5v4m0 0 1.6-1.6M8 11.5 6.4 9.9"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- Split affordances: wired to handlers but INERT until ticket 03 adds the
         tiling layout (TODO(ticket-03): grow the workspace to >1 Pane). Kept
         enabled so the seam is real and clickable; the handlers no-op for now. -->
    <div class="btn-group">
      <button
        type="button"
        class="icon-btn"
        data-testid="split-right"
        title="Split Right"
        aria-label="Split Right"
        onclick={onSplitRight}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2" />
          <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        data-testid="split-down"
        title="Split Down"
        aria-label="Split Down"
        onclick={onSplitDown}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2" />
          <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>
  </div>
</header>

<style>
  .pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.4rem;
    /* Wrap the controls onto a second row in narrow tiles (tiling) rather than
       letting them overflow and overlap the title/close affordances. Wide panes
       stay on one line, so single-pane layout is unchanged. */
    flex-wrap: wrap;
    flex: none;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
  }

  .pane-title-group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .pane-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }

  .pane-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
  }

  .btn-group {
    display: inline-flex;
    gap: 0.2rem;
  }

  /* Tri-state mode toggle: a connected segmented control (Source / Live / Read). */
  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .mode-btn {
    padding: 0 0.55rem;
    height: 1.7rem;
    border: none;
    border-left: 1px solid var(--border);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.76rem;
    cursor: pointer;
    line-height: 1;
    transition: background 0.12s ease;
  }

  .mode-btn:first-child {
    border-left: none;
  }

  .mode-btn:hover:not(:disabled):not(.active) {
    background: var(--hover);
  }

  .mode-btn.active {
    background: var(--accent);
    color: #fff;
  }

  .mode-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    line-height: 1;
    transition: background 0.12s ease;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--hover);
  }

  .icon-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
