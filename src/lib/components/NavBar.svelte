<script lang="ts">
  import type { EditorMode } from '$lib/editor/cm';

  interface Props {
    leftSidebarOpen: boolean;
    rightSidebarOpen: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    editorMode: EditorMode;
    hasOpenConcept: boolean;
    /** Whether the open Concept is currently in review (working-tree ↔ HEAD) mode. */
    reviewActive: boolean;
    /** Whether the review toggle is available (the file has reviewable history). */
    reviewEnabled: boolean;
    /** Tooltip for the review toggle (explains the disabled reason when disabled). */
    reviewTooltip: string;
    onToggleLeft: () => void;
    onToggleRight: () => void;
    onBack: () => void;
    onForward: () => void;
    onSetMode: (mode: EditorMode) => void;
    onToggleReview: () => void;
  }

  let {
    leftSidebarOpen,
    rightSidebarOpen,
    canGoBack,
    canGoForward,
    editorMode,
    hasOpenConcept,
    reviewActive,
    reviewEnabled,
    reviewTooltip,
    onToggleLeft,
    onToggleRight,
    onBack,
    onForward,
    onSetMode,
    onToggleReview,
  }: Props = $props();

  // The editor's tri-state view mode (Obsidian parity: Source / Live / Reading).
  // Display-only data for the mode toggle; the mode state and switch logic live
  // in App.svelte.
  const EDITOR_MODES: { mode: EditorMode; label: string; title: string }[] = [
    { mode: 'edit', label: 'Source', title: 'Source — raw markdown' },
    { mode: 'hybrid', label: 'Live', title: 'Live preview — render with the cursor line shown raw' },
    { mode: 'view', label: 'Read', title: 'Reading view — fully rendered, read-only' },
  ];
</script>

<nav class="nav-bar" aria-label="Navigation history">
  <div class="nav-left">
    <button
      type="button"
      class="nav-btn"
      data-testid="sidebar-toggle"
      title={leftSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      aria-label={leftSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      aria-pressed={leftSidebarOpen}
      onclick={onToggleLeft}
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
          opacity={leftSidebarOpen ? 0.5 : 0}
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
      disabled={!canGoBack}
      onclick={onBack}>←</button
    >
    <button
      type="button"
      class="nav-btn"
      data-testid="nav-forward"
      title="Forward (Ctrl+Alt+Right)"
      aria-label="Forward"
      disabled={!canGoForward}
      onclick={onForward}>→</button
    >
  </div>
  <div class="nav-right">
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
    <!-- Review changes (working-tree ↔ HEAD): a dedicated toggle SEPARATE from the
         mode segmented control above. Disabled with an explanatory tooltip when
         the open Concept has no reviewable git history. -->
    <button
      type="button"
      class="nav-btn"
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
        <path
          d="M4 8.5 Q4 5.5 10.4 5.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
        />
      </svg>
    </button>
    <button
      type="button"
      class="nav-btn"
      data-testid="right-sidebar-toggle"
      title={rightSidebarOpen
        ? 'Collapse Outline & Backlinks'
        : 'Expand Outline & Backlinks'}
      aria-label={rightSidebarOpen
        ? 'Collapse Outline & Backlinks'
        : 'Expand Outline & Backlinks'}
      aria-pressed={rightSidebarOpen}
      onclick={onToggleRight}
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
          opacity={rightSidebarOpen ? 0.5 : 0}
          stroke="none"
        />
      </svg>
    </button>
  </div>
</nav>

<style>
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
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-self: end;
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
    height: 1.9rem;
    border: none;
    border-left: 1px solid var(--border);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
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

  /* Review toggle "on" state: reuse the segmented control's active accent so the
     active affordance reads consistently across the two controls. */
  .nav-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
