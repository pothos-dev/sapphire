<script lang="ts">
  // Global app chrome (slice: per-tile-header). The NavBar holds ONLY controls
  // that are global to the whole app — not to any one Pane: the left/right
  // Sidebar collapse toggles, the global tri-state view-mode toggle (Source /
  // Live / Reading — applies to EVERY tile at once), and a global Properties
  // show/hide toggle. The remaining per-Concept / per-Pane controls (undo/redo,
  // review, export, close, split, history) live in the PaneHeader above the Editor.
  //
  // (Search and Quick-nav are keyboard-driven today — Ctrl+Shift+F / Ctrl+K —
  // and theme follows the OS, so those global affordances have no button here
  // yet; the seam is this bar when they grow one.)
  import type { EditorMode } from '$lib/editor/cm';

  interface Props {
    leftSidebarOpen: boolean;
    rightSidebarOpen: boolean;
    /** The global tri-state view mode (Source / Live / Reading) shared by all tiles. */
    editorMode: EditorMode;
    /** Whether a Concept is open (mode is meaningless with no document). */
    hasOpenConcept: boolean;
    /** Whether the global Properties panel is shown (drives per-tile Properties). */
    propertiesShown: boolean;
    onToggleLeft: () => void;
    onToggleRight: () => void;
    /** Switch the global view mode; applied to every visible tile at once. */
    onSetMode: (mode: EditorMode) => void;
    /**
     * Toggle the global Properties show/hide flag. When on, EVERY visible tile
     * renders its own Concept's frontmatter inline; when off, no tile shows any
     * Properties chrome. Persisted in the session store.
     */
    onToggleProperties: () => void;
  }

  let {
    leftSidebarOpen,
    rightSidebarOpen,
    editorMode,
    hasOpenConcept,
    propertiesShown,
    onToggleLeft,
    onToggleRight,
    onSetMode,
    onToggleProperties,
  }: Props = $props();

  // Display-only data for the global mode toggle; the mode state + switch logic
  // live in App.svelte / the session store. Icons — hashtag (Source), pen (Live),
  // book (Reading) — carry the meaning; the label is the accessible name/tooltip.
  const EDITOR_MODES: { mode: EditorMode; label: string; title: string }[] = [
    { mode: 'edit', label: 'Source', title: 'Source — raw markdown' },
    { mode: 'hybrid', label: 'Live', title: 'Live preview — render with the cursor line shown raw' },
    { mode: 'view', label: 'Read', title: 'Reading view — fully rendered, read-only' },
  ];
</script>

<nav class="nav-bar" aria-label="Global controls">
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
        <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" stroke-width="1.2" />
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
  <div class="nav-right">
    <!-- Global tri-state view mode (Source / Live / Reading): a connected
         segmented control of icons that applies to every visible tile at once. -->
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
          onclick={() => onSetMode(m.mode)}
        >
          {#if m.mode === 'edit'}
            <!-- Source: hashtag (raw markdown markers). -->
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <line x1="4" x2="20" y1="9" y2="9" />
              <line x1="4" x2="20" y1="15" y2="15" />
              <line x1="10" x2="8" y1="3" y2="21" />
              <line x1="16" x2="14" y1="3" y2="21" />
            </svg>
          {:else if m.mode === 'hybrid'}
            <!-- Live: pen (editable live-preview). -->
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          {:else}
            <!-- Reading: open book (fully rendered, read-only). -->
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Global Properties show/hide toggle: flips `session.propertiesShown`, which
         gates the inline Properties panel in every visible tile at once. -->
    <button
      type="button"
      class="nav-btn"
      class:active={propertiesShown}
      data-testid="properties-panel-toggle"
      title={propertiesShown ? 'Hide Properties' : 'Show Properties'}
      aria-label={propertiesShown ? 'Hide Properties' : 'Show Properties'}
      aria-pressed={propertiesShown}
      onclick={onToggleProperties}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <!-- sliders glyph: two horizontal rails with knobs (properties/settings). -->
        <line x1="2.5" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="1.2" />
        <line x1="2.5" y1="11" x2="13.5" y2="11" stroke="currentColor" stroke-width="1.2" />
        <circle cx="6" cy="5" r="1.8" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
        <circle cx="10.5" cy="11" r="1.8" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>
    <button
      type="button"
      class="nav-btn"
      data-testid="right-sidebar-toggle"
      title={rightSidebarOpen ? 'Collapse Outline & Backlinks' : 'Expand Outline & Backlinks'}
      aria-label={rightSidebarOpen ? 'Collapse Outline & Backlinks' : 'Expand Outline & Backlinks'}
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
        <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" stroke-width="1.2" />
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
  /* Two-track global bar: left Sidebar toggle at the start, the Properties +
     right-Sidebar toggles at the end. */
  .nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  .nav-left {
    display: flex;
    gap: 0.35rem;
  }

  .nav-right {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  /* Global tri-state mode toggle: a connected segmented control of icons. */
  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .mode-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: none;
    border-left: 1px solid var(--border);
    background: none;
    color: inherit;
    font: inherit;
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
