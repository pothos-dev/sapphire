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
  import { propertiesNav, VALUE_COL } from '$lib/state/propertiesNav.svelte';
  import { isNewTagIndex, moveChip, indexAfterDelete } from '$lib/chipStrip';

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

  // --- Chip sub-navigation (slice: properties-chip-subnavigation) ---
  //
  // A list value cell gets a THIRD focus depth on top of grid nav / edit:
  //   nav  → (Enter on the cell) → CHIPS sub-nav → (Enter on new-tag input) → EDIT.
  // In CHIPS mode focus rides a roving index across the strip
  // `[chip 0]…[chip n-1][+ new-tag input]`; ←/→ move it (↑/↓ inert), `d` deletes
  // the focused chip (focus → neighbour), and Enter on the new-tag input enters
  // text edit. Escape peels exactly one layer (edit → chips → grid nav), handled
  // locally here so the global capture handler doesn't skip a layer. The store
  // (`propertiesNav`) holds `mode` + `chipIndex`; this component owns the strip's
  // DOM focus + the local key handling. Chip-strip math lives in `$lib/chipStrip`.

  // The chip <button> elements and the new-tag <input>, for roving DOM focus.
  let chipEls = $state<(HTMLButtonElement | null)[]>([]);
  let addInput = $state<HTMLInputElement | null>(null);

  const items = $derived(prop.list ?? []);

  /** True when this row's VALUE cell is the Focused cell AND we're in chip sub-nav. */
  const inChips = $derived(
    prop.kind === 'list' &&
      propertiesNav.mode === 'chips' &&
      propertiesNav.cell.row === id &&
      propertiesNav.cell.col === VALUE_COL,
  );

  /** Mirror `chipIndex` into DOM focus while this row owns the chip sub-nav. */
  $effect(() => {
    if (!inChips) return;
    const idx = propertiesNav.chipIndex;
    const target = isNewTagIndex(idx, items.length) ? addInput : chipEls[idx];
    if (target && document.activeElement !== target) target.focus();
  });

  /** Move focus across the strip (←/→); ↑/↓ are inert. */
  function onChipNavKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const idx = propertiesNav.chipIndex;
    const count = items.length;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        event.stopPropagation();
        propertiesNav.chipIndex = moveChip(idx, 'right', count);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        event.stopPropagation();
        propertiesNav.chipIndex = moveChip(idx, 'left', count);
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        // Inert: don't let up/down eject the user from the strip (Escape leaves).
        event.preventDefault();
        event.stopPropagation();
        return;
      case 'Escape':
        // Peel one layer: chip sub-nav → grid nav (back to the value cell).
        event.preventDefault();
        event.stopPropagation();
        propertiesNav.toNav({ row: id, col: VALUE_COL });
        return;
    }
  }

  /** Keys on a focused CHIP: `d` deletes (focus → neighbour); Enter does nothing. */
  function onChipKey(event: KeyboardEvent, index: number) {
    onChipNavKeydown(event);
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'd') {
      event.preventDefault();
      event.stopPropagation();
      const next = indexAfterDelete(index, items.length);
      removeChip(id, items, index);
      propertiesNav.chipIndex = next;
    } else if (event.key === 'Enter') {
      // Enter on a chip does NOTHING (per the slice). Swallow it so it neither
      // bubbles to the grid handler nor triggers a native button click.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /** Keys on the new-tag input WHILE in chip sub-nav (not yet typing). */
  function onAddInputChipKey(event: KeyboardEvent) {
    onChipNavKeydown(event);
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Enter') {
      // Enter focuses the new-tag input for TYPING → edit mode (depth 3).
      event.preventDefault();
      event.stopPropagation();
      propertiesNav.mode = 'edit';
    }
  }

  /** Keys on the new-tag input WHILE typing (edit mode, depth 3). */
  function onAddInputEditKey(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return; // native incl. copy/paste
    if (event.key === 'Enter') {
      // Commit the chip (existing behaviour), staying in text edit to add more.
      event.preventDefault();
      event.stopPropagation();
      addChip(id, items);
      propertiesNav.chipIndex = items.length;
    } else if (event.key === 'Escape') {
      // Peel one layer: text edit → chip sub-nav (focus the new-tag input).
      // Abandon the in-progress draft so the peel commits nothing.
      event.preventDefault();
      event.stopPropagation();
      chipDraft = '';
      propertiesNav.toChips(items.length);
    }
  }

  /** Route the new-tag input's keydown by mode (chip sub-nav vs typing). */
  function onAddInputKeydown(event: KeyboardEvent) {
    if (propertiesNav.mode === 'edit') {
      onAddInputEditKey(event);
    } else if (inChips) {
      onAddInputChipKey(event);
    } else {
      // Direct (mouse) focus with no sub-nav active: keep the legacy Enter-adds.
      onChipKeydown(event, id, items);
    }
  }

  /** Tabindex for a chip: roving 0 only on the focused chip in chip sub-nav. */
  function chipTabindex(index: number): number {
    return inChips && propertiesNav.chipIndex === index ? 0 : -1;
  }

  /** Tabindex for the new-tag input: roving 0 when it's the focused strip slot. */
  const addTabindex = $derived(
    inChips && isNewTagIndex(propertiesNav.chipIndex, items.length) ? 0 : -1,
  );
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
      {#each items as item, i (i + ':' + item)}
        <!-- A chip is a roving-tabindex button in chip sub-nav: ←/→ move across
             the strip, `d` deletes it. Clicking it focuses it (mouse parity);
             the × still removes it. -->
        <button
          type="button"
          class="chip"
          class:chip-active={inChips && propertiesNav.chipIndex === i}
          tabindex={chipTabindex(i)}
          data-testid={`chip-${prop.key}`}
          data-chip-index={i}
          bind:this={chipEls[i]}
          onkeydown={(e) => onChipKey(e, i)}
        >
          {item}
          <!-- Mouse-only remove affordance (mouse parity). Keyboard deletes via
               `d` on the focused chip (above), so no key handler is needed here;
               a nested <button> is invalid inside the chip <button>. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="chip-remove"
            aria-label={`Remove ${item}`}
            data-testid={`chip-remove-${prop.key}`}
            onclick={(e) => {
              e.stopPropagation();
              removeChip(id, items, i);
            }}>×</span
          >
        </button>
      {/each}
      <input
        id={`prop-${prop.key}`}
        class="chip-input"
        type="text"
        tabindex={addTabindex}
        placeholder="Add…"
        data-testid={`chip-add-${prop.key}`}
        list="tag-suggestions"
        bind:value={chipDraft}
        bind:this={addInput}
        onkeydown={onAddInputKeydown}
        onblur={() => addChip(id, items)}
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
    border: 1px solid transparent;
    background: var(--tag-bg);
    color: var(--tag-text);
    font: inherit;
    cursor: pointer;
  }

  /* Spotlight ring on the focused chip in chip sub-nav (mirrors the cell ring). */
  .chip:focus,
  .chip:focus-visible {
    outline: none;
  }

  .chip.chip-active {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .chip-remove {
    display: inline-flex;
    align-items: center;
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
