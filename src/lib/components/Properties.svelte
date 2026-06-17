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

  interface Props {
    /** The open Concept's frontmatter properties (source of truth). */
    properties: Property[];
    /** Bundle-relative path of the open Concept (for the reserved-file exemption). */
    path: string | null;
    /** Existing Bundle `type` values, for the `type` field's autocomplete. */
    types?: string[];
    /**
     * When true, focus the `type` input on mount/path-change. Set by the app
     * shell right after a NEW Concept is created so the user lands in `type`.
     */
    focusType?: boolean;
    /** Called with the new properties after an edit. */
    onchange: (props: Property[]) => void;
  }

  let { properties, path, types = [], focusType = false, onchange }: Props = $props();

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

  // Draft text for the per-list "add chip" inputs, keyed by property key.
  let chipDrafts = $state<Record<string, string>>({});

  // Local draft text for the key inputs, keyed by row id. `undefined` means the
  // input shows the live key; a string means the user is mid-edit. We reset a
  // draft once it matches the (possibly newly-committed) live key again.
  let keyDrafts = $state<Record<number, string>>({});

  function keyDraftValue(id: number, liveKey: string): string {
    const d = keyDrafts[id];
    return d === undefined ? liveKey : d;
  }

  /** Commit a key rename for the row at `id` (blur / Enter). */
  function commitKey(id: number) {
    const prop = properties[id];
    if (!prop) return;
    const next = (keyDrafts[id] ?? prop.key).trim();
    // Clear the draft regardless of outcome (revert reverts to the live key).
    delete keyDrafts[id];
    if (next === '' || next === prop.key) return; // empty or no-op -> revert
    const duplicate = properties.some((p, i) => i !== id && p.key === next);
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

  /** Replace the value of the scalar property `key`. */
  function editScalar(key: string, value: string) {
    onchange(properties.map((p) => (p.key === key ? { ...p, scalar: value } : p)));
  }

  /** Set the items of the list property `key`. */
  function setListItems(key: string, items: string[]) {
    onchange(properties.map((p) => (p.key === key ? { ...p, list: items } : p)));
  }

  function addChip(key: string, current: string[]) {
    const draft = (chipDrafts[key] ?? '').trim();
    if (draft === '') return;
    setListItems(key, [...current, draft]);
    chipDrafts[key] = '';
  }

  function removeChip(key: string, current: string[], index: number) {
    const next = current.slice();
    next.splice(index, 1);
    setListItems(key, next);
  }

  function onChipKeydown(event: KeyboardEvent, key: string, current: string[]) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addChip(key, current);
    }
  }
</script>

<section class="properties" aria-label="Properties" data-testid="properties">
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
          value={keyDraftValue(id, prop.key)}
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

      <div class="value">
        {#if prop.kind === 'scalar' && isType}
          <!-- The `type` field: autocompletes against existing Bundle types via
               a datalist (free entry still allowed), and is the focus target
               when a new Concept opens. -->
          <input
            id={`prop-${prop.key}`}
            class="text"
            type="text"
            data-testid={`scalar-${prop.key}`}
            list="type-suggestions"
            bind:this={typeInput}
            value={prop.scalar ?? ''}
            onchange={(e) => editScalar(prop.key, (e.currentTarget as HTMLInputElement).value)}
          />
          <datalist id="type-suggestions" data-testid="type-suggestions">
            {#each types as t (t)}
              <option value={t}></option>
            {/each}
          </datalist>
        {:else if prop.kind === 'scalar'}
          <input
            id={`prop-${prop.key}`}
            class="text"
            type="text"
            data-testid={`scalar-${prop.key}`}
            value={prop.scalar ?? ''}
            onchange={(e) => editScalar(prop.key, (e.currentTarget as HTMLInputElement).value)}
          />
        {:else if prop.kind === 'list'}
          <div class="chips" data-testid={`chips-${prop.key}`}>
            {#each prop.list ?? [] as item, i (i + ':' + item)}
              <span class="chip" data-testid={`chip-${prop.key}`}>
                {item}
                <button
                  type="button"
                  class="chip-remove"
                  aria-label={`Remove ${item}`}
                  data-testid={`chip-remove-${prop.key}`}
                  onclick={() => removeChip(prop.key, prop.list ?? [], i)}>×</button
                >
              </span>
            {/each}
            <input
              id={`prop-${prop.key}`}
              class="chip-input"
              type="text"
              placeholder="Add…"
              data-testid={`chip-add-${prop.key}`}
              bind:value={chipDrafts[prop.key]}
              onkeydown={(e) => onChipKeydown(e, prop.key, prop.list ?? [])}
              onblur={() => addChip(prop.key, prop.list ?? [])}
            />
          </div>
        {:else}
          <textarea
            id={`prop-${prop.key}`}
            class="raw"
            data-testid={`raw-${prop.key}`}
            readonly
            rows={Math.min(8, (prop.raw ?? '').split('\n').length)}
            value={prop.raw ?? ''}
          ></textarea>
        {/if}
      </div>
    </div>
  {/each}
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

  .value {
    min-width: 0;
  }

  .text,
  .chip-input,
  .raw {
    font-family: var(--font-ui);
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.4rem;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .text:focus,
  .chip-input:focus,
  .raw:focus,
  .text:focus-visible,
  .chip-input:focus-visible,
  .raw:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .text {
    width: 100%;
    box-sizing: border-box;
  }

  .raw {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    opacity: 0.85;
    white-space: pre;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.2rem 0.1rem 0.5rem;
    border-radius: var(--radius-pill);
    background: var(--tag-bg);
    color: var(--tag-text);
  }

  .chip-remove {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.15rem;
    border-radius: var(--radius-sm);
    transition: background-color 0.15s ease;
  }

  .chip-remove:hover {
    background: var(--hover);
  }

  .chip-input {
    flex: 1 1 6rem;
    min-width: 5rem;
  }
</style>
