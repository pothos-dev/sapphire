<script lang="ts">
  import type { EditorMode } from '$lib/editor/cm';

  interface Props {
    /** The editor's current tri-state view mode. */
    editorMode: EditorMode;
    /** Whether a Concept is open (mode is meaningless with no document). */
    hasOpenConcept: boolean;
    onSetMode: (mode: EditorMode) => void;
  }

  let { editorMode, hasOpenConcept, onSetMode }: Props = $props();

  // The editor's tri-state view mode (Obsidian parity: Source / Live / Reading),
  // rendered as an icon control that OVERLAYS the lower-right of the Concept view.
  // Display-only: the mode state and switch logic live in App.svelte. Icons —
  // hashtag (Source), pen (Live), book (Reading) — carry the meaning; the label
  // survives as the accessible name / tooltip.
  const EDITOR_MODES: { mode: EditorMode; label: string; title: string }[] = [
    { mode: 'edit', label: 'Source', title: 'Source — raw markdown' },
    { mode: 'hybrid', label: 'Live', title: 'Live preview — render with the cursor line shown raw' },
    { mode: 'view', label: 'Read', title: 'Reading view — fully rendered, read-only' },
  ];
</script>

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

<style>
  /* Tri-state mode toggle: a connected segmented control of icons, floated over
     the lower-right corner of the Concept view (App.svelte's `.editor-pane` is
     the positioned ancestor). Elevated so it reads over rendered content. */
  .mode-toggle {
    position: absolute;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 5;
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-elevated, var(--bg));
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
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
</style>
