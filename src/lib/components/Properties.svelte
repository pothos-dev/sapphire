<script lang="ts">
  // Frontmatter Properties panel (ADR 0003, structured frontmatter model).
  //
  // Renders the focused Concept's frontmatter as typed inputs above the editor
  // body:
  //   - scalar  -> single text input
  //   - list    -> chip input (add/remove)
  //   - complex -> read-only raw textarea, preserved verbatim
  //
  // The structured `properties` are the single source of truth (held in the
  // editor's `frontmatterField`). Editing produces a NEW `Property[]` and reports
  // it through `onchange`; the app shell dispatches it into the field and the
  // editor recombines `serialize(props) + body` for autosave.

  import { isTypeMissing, renameProperty, type Property } from '$lib/frontmatter';
  import { isReservedFile } from '$lib/reserved';
  import PropertyRow from './PropertyRow.svelte';

  interface Props {
    /** The open Concept's frontmatter properties (source of truth). */
    properties: Property[];
    /** Bundle-relative path of the open Concept (for the reserved-file exemption). */
    path: string | null;
    /** Existing Bundle `type` values, for the `type` field's autocomplete. */
    types?: string[];
    /**
     * Key-name suggestions for the key inputs (when adding/renaming a key):
     * OKF recommended keys ∪ distinct keys used across the Bundle. Merged and
     * deduped by the caller (App.svelte).
     */
    keys?: string[];
    /**
     * Tag-value suggestions for list (chip) inputs: distinct tag values used
     * across the Bundle. No OKF tag vocabulary exists, so this is bundle-sourced
     * only. Applied to every list field's chip input (`tags` and any other list).
     */
    tags?: string[];
    /**
     * When true, focus the `type` input on mount/path-change. Set by the app
     * shell right after a NEW Concept is created so the user lands in `type`.
     */
    focusType?: boolean;
    /** Called with the new properties after an edit. */
    onchange: (props: Property[]) => void;
    /**
     * Unified undo/redo (unified-body-frontmatter-undo). The panel doesn't hold
     * the editor view, so the app shell passes the editor-history commands and
     * their availability. The buttons drive the SAME single timeline that spans
     * body + frontmatter.
     */
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
  }

  let {
    properties,
    path,
    types = [],
    keys = [],
    tags = [],
    focusType = false,
    onchange,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
  }: Props = $props();

  // Reserved files (`index.md`/`log.md`) are EXEMPT from the required-`type`
  // rule (OKF): never flag a missing/empty `type` on them. The raw check lives
  // in `isTypeMissing`; the exemption is applied here, at the caller.
  const reserved = $derived(path !== null && isReservedFile(path));
  const typeMissing = $derived(!reserved && isTypeMissing(properties));
  // Whether a `type` property exists at all (it may have been renamed/deleted).
  // When `type` is missing AND there is no row to host the inline flag, we show
  // a panel-level banner so the required-`type` warning still appears.
  const hasTypeRow = $derived(properties.some((p) => p.key === 'type'));

  // The `type` input element, focused when a new Concept opens so the user
  // lands in `type` (the field they must fill to make the Concept OKF-valid).
  let typeInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    // Re-focus when the requested-focus flag is set for the open path.
    void path;
    if (focusType && typeInput) {
      typeInput.focus();
      typeInput.select();
    }
  });

  // Stable per-row view-models. Rows are keyed by a positional `id` rather than
  // by `prop.key`, so editing a key char-by-char (a LOCAL draft, committed only
  // on blur/Enter) never re-keys the row and steals focus. Position is stable
  // across re-parse (the serializer preserves document order) and the array is
  // rebuilt wholesale on every change, so the id never desyncs from its prop.
  const rows = $derived(properties.map((prop, id) => ({ id, prop })));

  // Draft text for the per-list "add chip" inputs, keyed by ROW ID (the
  // positional index), not by `prop.key`. Keying by id means a duplicate key
  // (from an externally-authored file) gets a distinct draft per row, and the
  // draft always attaches to the row actually being edited.
  let chipDrafts = $state<Record<number, string>>({});

  // Local draft text for the key inputs, keyed by row id. `undefined` means the
  // input shows the live key; a string means the user is mid-edit. We reset a
  // draft once it matches the (possibly newly-committed) live key again.
  let keyDrafts = $state<Record<number, string>>({});

  // Row id of a freshly ADDED property awaiting its first key commit. It opens
  // with the key input focused and empty; blurring it empty DISCARDS the row
  // (slice: add-property-text-or-list). `null` when no add is pending. New rows
  // are appended, so the new id is always the last index (`properties.length`).
  let newRowId = $state<number | null>(null);

  /**
   * Append a new property and mark its row for auto-focus + discard-on-empty.
   * The created KIND is fixed (no after-the-fact conversion). The new row lands
   * at the end of `properties`, so its positional id is the current length.
   */
  function addProperty(prop: Property) {
    newRowId = properties.length;
    onchange([...properties, prop]);
  }

  function addText() {
    addProperty({ key: '', kind: 'scalar', scalar: '' });
  }

  function addList() {
    addProperty({ key: '', kind: 'list', list: [] });
  }

  /**
   * Focus action for a row's key input. Focuses + selects only the just-added
   * row (`newRowId`), so adding a property lands the cursor in its empty key.
   */
  function autofocusKey(node: HTMLInputElement, id: number) {
    if (id === newRowId) {
      node.focus();
      node.select();
    }
    return {};
  }

  function keyDraftValue(id: number, liveKey: string): string {
    const d = keyDrafts[id];
    return d === undefined ? liveKey : d;
  }

  /** Commit a key rename for the row at `id` (blur / Enter). */
  function commitKey(id: number) {
    const prop = properties[id];
    if (!prop) return;
    const isNew = id === newRowId;
    const next = (keyDrafts[id] ?? prop.key).trim();
    const duplicate = properties.some((p, i) => i !== id && p.key === next);

    if (isNew) {
      // A freshly added row has no prior key to revert to (unlike slice 2's
      // rename). So both rejection cases DISCARD the row: an empty key, and a
      // duplicate key. Discarding is the least-surprising consistent rule — it
      // never commits under the duplicate name and leaves no half-edited row
      // lingering after blur (no focus-fighting). The user simply re-adds.
      delete keyDrafts[id];
      newRowId = null;
      if (next === '' || duplicate) {
        onchange(properties.filter((_, i) => i !== id));
        return;
      }
      onchange(properties.map((p, i) => (i === id ? renameProperty(p, next) : p)));
      return;
    }

    // Clear the draft regardless of outcome (revert reverts to the live key).
    delete keyDrafts[id];
    if (next === '' || next === prop.key) return; // empty or no-op -> revert
    if (duplicate) return; // duplicate key -> revert
    onchange(properties.map((p, i) => (i === id ? renameProperty(p, next) : p)));
  }

  /** Abandon an in-progress key edit (Escape), reverting to the live key. */
  function cancelKey(id: number) {
    delete keyDrafts[id];
  }

  function onKeyKeydown(event: KeyboardEvent, id: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.currentTarget as HTMLInputElement).blur(); // triggers commit
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelKey(id);
      (event.currentTarget as HTMLInputElement).blur();
    }
  }

  /** Remove the property at row `id`. */
  function deleteProperty(id: number) {
    delete keyDrafts[id];
    onchange(properties.filter((_, i) => i !== id));
  }

  // Value edits address the row by its positional `id` (the array index), NOT by
  // `prop.key`. With duplicate keys forbidden in-app, key and id agree; but an
  // externally-authored file can still carry duplicate keys, and addressing by
  // id targets the exact row being edited rather than the first key match. The
  // id ↔ array-index contract holds: `properties` is rebuilt wholesale on every
  // change (document order preserved), so the index never desyncs from its prop.

  /** Replace the value of the scalar property at row `id`. */
  function editScalar(id: number, value: string) {
    onchange(properties.map((p, i) => (i === id ? { ...p, scalar: value } : p)));
  }

  /** Set the items of the list property at row `id`. */
  function setListItems(id: number, items: string[]) {
    onchange(properties.map((p, i) => (i === id ? { ...p, list: items } : p)));
  }

  function addChip(id: number, current: string[]) {
    const draft = (chipDrafts[id] ?? '').trim();
    if (draft === '') return;
    setListItems(id, [...current, draft]);
    chipDrafts[id] = '';
  }

  function removeChip(id: number, current: string[], index: number) {
    const next = current.slice();
    next.splice(index, 1);
    setListItems(id, next);
  }

  function onChipKeydown(event: KeyboardEvent, id: number, current: string[]) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addChip(id, current);
    }
  }
</script>

<section class="properties" aria-label="Properties" data-testid="properties">
  <!-- Panel header: unified undo/redo over the single body+frontmatter history.
       Buttons mousedown-prevent default so clicking them does not blur (and thus
       commit) an in-progress scalar/key edit before the command runs. -->
  <div class="panel-header" data-testid="properties-header">
    <div class="history">
      <button
        type="button"
        class="hist-btn"
        data-testid="undo"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        disabled={!canUndo}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => onUndo?.()}>↶</button
      >
      <button
        type="button"
        class="hist-btn"
        data-testid="redo"
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        disabled={!canRedo}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => onRedo?.()}>↷</button
      >
    </div>
  </div>

  {#if properties.length === 0}
    <p class="empty" data-testid="properties-empty">No frontmatter.</p>
  {/if}

  {#if typeMissing && !hasTypeRow}
    <p class="banner" data-testid="type-missing" role="alert">
      The required <code>type</code> field is missing.
    </p>
  {/if}

  {#each rows as { id, prop } (id)}
    {@const isType = prop.key === 'type'}
    <div class="row" class:flagged={isType && typeMissing} data-key={prop.key}>
      <div class="key">
        <input
          class="key-input"
          type="text"
          aria-label={`Property name: ${prop.key}`}
          data-testid={`key-${prop.key}`}
          list="key-suggestions"
          value={keyDraftValue(id, prop.key)}
          use:autofocusKey={id}
          oninput={(e) => (keyDrafts[id] = (e.currentTarget as HTMLInputElement).value)}
          onblur={() => commitKey(id)}
          onkeydown={(e) => onKeyKeydown(e, id)}
        />
        {#if isType && typeMissing}
          <span class="flag" data-testid="type-missing" title="The required `type` field is missing or empty"
            >required</span
          >
        {/if}
        <button
          type="button"
          class="row-remove"
          aria-label={`Delete ${prop.key}`}
          data-testid={`delete-${prop.key}`}
          onclick={() => deleteProperty(id)}>×</button
        >
      </div>

      <PropertyRow
        {id}
        {prop}
        {isType}
        {types}
        {editScalar}
        {addChip}
        {removeChip}
        {onChipKeydown}
        bind:chipDraft={chipDrafts[id]}
        bind:typeInput
      />
    </div>
  {/each}

  <!-- Shared autocomplete sources. The key datalist is referenced by every key
       input (`list="key-suggestions"`): OKF recommended keys ∪ keys used
       elsewhere in the Bundle. The tag datalist backs every list field's chip
       input (`list="tag-suggestions"`): distinct bundle tag values (no fixed
       OKF tag vocabulary). Both refresh via App.svelte on `indexStore.version`. -->
  <datalist id="key-suggestions" data-testid="key-suggestions">
    {#each keys as k (k)}
      <option value={k}></option>
    {/each}
  </datalist>
  <datalist id="tag-suggestions" data-testid="tag-suggestions">
    {#each tags as t (t)}
      <option value={t}></option>
    {/each}
  </datalist>

  <!-- Add controls: create a new scalar (`Text`) or flat-list (`List`) property.
       The kind is fixed at creation. Shown in both the empty and populated
       states; new rows append after existing ones. -->
  <div class="add" data-testid="properties-add">
    <button type="button" class="add-btn" data-testid="add-text" onclick={addText}>
      + Text
    </button>
    <button type="button" class="add-btn" data-testid="add-list" onclick={addList}>
      + List
    </button>
  </div>
</section>

<style>
  .properties {
    padding: 0.6rem 1.5rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-family: var(--font-ui);
    font-size: 0.85rem;
    background: var(--bg-sunken);
  }

  .panel-header {
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  .history {
    display: flex;
    gap: 0.2rem;
  }

  .hist-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  .hist-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }

  .hist-btn:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .hist-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
    font-style: italic;
  }

  .banner {
    margin: 0;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--danger);
    color: var(--danger-contrast);
    font-size: 0.78rem;
    font-weight: 600;
  }

  .banner code {
    font-family: var(--font-mono);
  }

  .row {
    display: grid;
    grid-template-columns: 9rem 1fr;
    align-items: start;
    gap: 0.6rem;
  }

  .key {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
    min-width: 0;
  }

  .key-input {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: inherit;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.3rem;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background-color 0.15s ease;
  }

  .key-input:hover {
    border-color: var(--border-strong);
  }

  .key-input:focus,
  .key-input:focus-visible {
    outline: none;
    color: var(--text);
    background: var(--bg-elevated);
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .row.flagged .key,
  .row.flagged .key-input {
    color: var(--danger);
    font-weight: 600;
  }

  .row-remove {
    flex: 0 0 auto;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.2rem;
    border-radius: var(--radius-sm);
    opacity: 0;
    transition:
      background-color 0.15s ease,
      opacity 0.15s ease;
  }

  .row:hover .row-remove,
  .row:focus-within .row-remove {
    opacity: 1;
  }

  .row-remove:hover {
    background: var(--hover);
    color: var(--danger);
  }

  .flag {
    display: inline-block;
    margin-left: 0.3rem;
    padding: 0 0.35rem;
    border-radius: var(--radius-pill);
    background: var(--danger);
    color: var(--danger-contrast);
    font-size: 0.65rem;
    font-weight: 600;
    vertical-align: middle;
  }

  .add {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.15rem;
  }

  .add-btn {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.55rem;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      color 0.15s ease,
      background-color 0.15s ease;
  }

  .add-btn:hover {
    color: var(--text);
    border-color: var(--accent);
    background: var(--hover);
  }

  .add-btn:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
