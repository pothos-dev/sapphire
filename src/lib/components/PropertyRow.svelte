<script lang="ts">
  // Per-row VALUE EDITOR for the frontmatter Properties panel (ADR 0003).
  //
  // Renders the value editor for ONE frontmatter property, dispatching on kind:
  //   - scalar `type` -> single text input + the Bundle-`type` datalist
  //   - scalar        -> single text input
  //   - list          -> chip input (add/remove)
  //   - complex/raw    -> read-only raw textarea, preserved verbatim
  //
  // The owning <Properties> keeps the row collection, key inputs, add controls,
  // and the shared key/tag datalists. This component is value-editor-only: it
  // reports edits back through the callbacks, never mutating `prop` directly.
  //
  // Keying note: scalar/list edits are dispatched by the row's positional `id`
  // (the array index into the frontmatter properties — see editScalar/
  // setListItems in Properties), NOT by `prop.key`. Keying by id targets the
  // exact row even when two rows share a key (a file authored outside the app).
  // The "add chip" draft is held in Properties keyed by the same id. This
  // component is given the id + the draft for THIS row and bubbles changes back;
  // it does not own draft state.

  import type { Property } from '$lib/frontmatter';

  interface Props {
    /** Positional row id (array index) used to address this row on edit. */
    id: number;
    /** The property whose value this row edits (source of truth). */
    prop: Property;
    /** True when this row is the special `type` scalar (datalist + focus target). */
    isType: boolean;
    /** Existing Bundle `type` values, for the `type` field's datalist. */
    types: string[];
    /** Draft text for this list row's "add chip" input (bound). */
    chipDraft: string;
    /** Replace the value of the scalar property at row `id`. */
    editScalar: (id: number, value: string) => void;
    /** Append the current chip draft (if non-empty) to the list property at row `id`. */
    addChip: (id: number, current: string[]) => void;
    /** Remove the chip at `index` from the list property at row `id`. */
    removeChip: (id: number, current: string[], index: number) => void;
    /** Enter-to-add handler for the chip input. */
    onChipKeydown: (event: KeyboardEvent, id: number, current: string[]) => void;
    /**
     * Bound back to the parent's `typeInput`: the `type` <input> element, which
     * the panel focuses when a new Concept opens. Only set for the `type` row.
     */
    typeInput?: HTMLInputElement | null;
  }

  let {
    id,
    prop,
    isType,
    types,
    chipDraft = $bindable(),
    editScalar,
    addChip,
    removeChip,
    onChipKeydown,
    typeInput = $bindable(),
  }: Props = $props();
</script>

<div class="value">
  {#if prop.kind === 'scalar' && isType}
    <!-- The `type` field: autocompletes against existing Bundle types via
         a datalist (free entry still allowed), and is the focus target
         when a new Concept opens. -->
    <input
      id={`prop-${prop.key}`}
      class="text"
      type="text"
      tabindex="-1"
      data-testid={`scalar-${prop.key}`}
      list="type-suggestions"
      bind:this={typeInput}
      value={prop.scalar ?? ''}
      onchange={(e) => editScalar(id, (e.currentTarget as HTMLInputElement).value)}
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
      tabindex="-1"
      data-testid={`scalar-${prop.key}`}
      value={prop.scalar ?? ''}
      onchange={(e) => editScalar(id, (e.currentTarget as HTMLInputElement).value)}
    />
  {:else if prop.kind === 'list'}
    <div class="chips" data-testid={`chips-${prop.key}`}>
      {#each prop.list ?? [] as item, i (i + ':' + item)}
        <span class="chip" data-testid={`chip-${prop.key}`}>
          {item}
          <button
            type="button"
            class="chip-remove"
            tabindex="-1"
            aria-label={`Remove ${item}`}
            data-testid={`chip-remove-${prop.key}`}
            onclick={() => removeChip(id, prop.list ?? [], i)}>×</button
          >
        </span>
      {/each}
      <input
        id={`prop-${prop.key}`}
        class="chip-input"
        type="text"
        tabindex="-1"
        placeholder="Add…"
        data-testid={`chip-add-${prop.key}`}
        list="tag-suggestions"
        bind:value={chipDraft}
        onkeydown={(e) => onChipKeydown(e, id, prop.list ?? [])}
        onblur={() => addChip(id, prop.list ?? [])}
      />
    </div>
  {:else}
    <textarea
      id={`prop-${prop.key}`}
      class="raw"
      tabindex="-1"
      data-testid={`raw-${prop.key}`}
      readonly
      rows={Math.min(8, (prop.raw ?? '').split('\n').length)}
      value={prop.raw ?? ''}
    ></textarea>
  {/if}
</div>

<style>
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
