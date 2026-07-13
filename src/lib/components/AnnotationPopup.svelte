<script lang="ts">
  /**
   * A small floating text-input popup for authoring/editing a CriticMarkup
   * annotation's note (feat/criticmarkup-annotations). Opened by the editor's
   * "Add comment" menu item (add mode) and by clicking a comment gutter icon
   * (edit mode) — the latter works in reading mode too, the preferred way to
   * annotate. The raw `{==...==}{>>...<<}` markup stays editable in the buffer;
   * this just spares the user the syntax.
   *
   * Positioned at (x, y), it holds a textarea, a Save/Cancel pair and — in edit
   * mode — a Remove button. Save commits via `onsave(text)`; Escape/outside-click
   * cancel via `onclose` (Escape is driven by the global overlay peel in
   * App.svelte, mirroring ContextMenu). Ctrl/Cmd+Enter also saves.
   */
  interface Props {
    x: number;
    y: number;
    mode: 'add' | 'edit';
    initialText?: string;
    onsave: (text: string) => void;
    onremove?: () => void;
    onclose: () => void;
  }

  let { x, y, mode, initialText = '', onsave, onremove, onclose }: Props = $props();

  // Seed once from the prop: the popup is remounted per open ({#if} in App), so
  // the initial value is exactly the note to edit (or '' for add).
  // svelte-ignore state_referenced_locally
  let text = $state(initialText);
  let textarea = $state<HTMLTextAreaElement | null>(null);

  // Keep the popup on-screen: clamp its top-left so a card near the right/bottom
  // edge doesn't spill out of the viewport (approximate card size).
  const W = 300;
  const H = 160;
  const left = $derived(
    typeof window !== 'undefined' ? Math.min(x, window.innerWidth - W - 8) : x,
  );
  const top = $derived(
    typeof window !== 'undefined' ? Math.min(y, window.innerHeight - H - 8) : y,
  );

  // Autofocus the textarea (and select existing text so an edit can be retyped).
  $effect(() => {
    textarea?.focus();
    if (mode === 'edit') textarea?.select();
  });

  function save() {
    onsave(text);
  }

  function onKeydown(e: KeyboardEvent) {
    // Ctrl/Cmd+Enter commits (plain Enter inserts a newline — notes may wrap).
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }
</script>

<!-- Backdrop: an outside click cancels (mirrors ContextMenu). -->
<div class="backdrop" role="presentation" onclick={onclose}></div>

<div
  class="popup"
  role="dialog"
  aria-label={mode === 'add' ? 'Add comment' : 'Edit comment'}
  data-testid="annotation-popup"
  style="left: {left}px; top: {top}px"
>
  <textarea
    bind:this={textarea}
    bind:value={text}
    class="note"
    data-testid="annotation-input"
    placeholder="Write a comment…"
    rows="3"
    onkeydown={onKeydown}
  ></textarea>
  <div class="actions">
    {#if mode === 'edit' && onremove}
      <button
        type="button"
        class="btn danger"
        data-testid="annotation-remove"
        onclick={onremove}
      >Remove</button>
    {/if}
    <span class="spacer"></span>
    <button type="button" class="btn" data-testid="annotation-cancel" onclick={onclose}
      >Cancel</button
    >
    <button type="button" class="btn primary" data-testid="annotation-save" onclick={save}
      >Save</button
    >
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .popup {
    position: fixed;
    z-index: 1001;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: var(--shadow-md);
    font-family: var(--font-ui);
    font-size: 0.85rem;
  }

  .note {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 3.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .note:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: -1px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .spacer {
    flex: 1;
  }

  .btn {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .btn:hover {
    background: var(--hover);
  }

  .btn.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .btn.primary:hover {
    filter: brightness(1.05);
  }

  .btn.danger {
    color: var(--danger);
  }

  .btn.danger:hover {
    background: var(--danger);
    color: var(--danger-contrast);
  }
</style>
