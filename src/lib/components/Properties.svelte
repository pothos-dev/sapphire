<script lang="ts">
  // Frontmatter Properties panel (ADR 0002, flat key/value model).
  //
  // Renders the focused Concept's leading YAML frontmatter as typed inputs above
  // the editor body:
  //   - scalar  -> single text input
  //   - list    -> chip input (add/remove)
  //   - complex -> read-only raw textarea, preserved verbatim
  //
  // Editing produces a new full markdown string (via the frontmatter module's
  // verbatim-preserving splice) and reports it through `onchange`, which the app
  // shell feeds into the existing autosave path. We never re-serialize the whole
  // YAML doc, so complex/unknown values and the body round-trip byte-for-byte.

  import {
    parseProperties,
    isTypeMissing,
    setScalar,
    setList,
    type Property,
  } from '$lib/frontmatter';

  interface Props {
    /** Raw markdown of the open Concept (source of truth). */
    content: string;
    /** Called with new full markdown after a property edit. */
    onchange: (content: string) => void;
  }

  let { content, onchange }: Props = $props();

  const props = $derived<Property[]>(parseProperties(content));
  const typeMissing = $derived(isTypeMissing(props));

  // Draft text for the per-list "add chip" inputs, keyed by property key.
  let chipDrafts = $state<Record<string, string>>({});

  function editScalar(key: string, value: string) {
    onchange(setScalar(content, key, value));
  }

  function addChip(key: string, current: string[]) {
    const draft = (chipDrafts[key] ?? '').trim();
    if (draft === '') return;
    onchange(setList(content, key, [...current, draft]));
    chipDrafts[key] = '';
  }

  function removeChip(key: string, current: string[], index: number) {
    const next = current.slice();
    next.splice(index, 1);
    onchange(setList(content, key, next));
  }

  function onChipKeydown(event: KeyboardEvent, key: string, current: string[]) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addChip(key, current);
    }
  }
</script>

<section class="properties" aria-label="Properties" data-testid="properties">
  {#if props.length === 0}
    <p class="empty" data-testid="properties-empty">No frontmatter.</p>
  {/if}

  {#each props as prop (prop.key)}
    {@const isType = prop.key === 'type'}
    <div class="row" class:flagged={isType && typeMissing} data-key={prop.key}>
      <label class="key" for={`prop-${prop.key}`}>
        {prop.key}
        {#if isType && typeMissing}
          <span class="flag" data-testid="type-missing" title="The required `type` field is missing or empty"
            >required</span
          >
        {/if}
      </label>

      <div class="value">
        {#if prop.kind === 'scalar'}
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
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid rgba(127, 127, 127, 0.3);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
    background: rgba(127, 127, 127, 0.04);
  }

  .empty {
    margin: 0;
    color: #888;
    font-style: italic;
  }

  .row {
    display: grid;
    grid-template-columns: 9rem 1fr;
    align-items: start;
    gap: 0.6rem;
  }

  .key {
    color: #666;
    padding-top: 0.3rem;
    overflow-wrap: anywhere;
  }

  @media (prefers-color-scheme: dark) {
    .key {
      color: #aaa;
    }
  }

  .row.flagged .key {
    color: #c0392b;
    font-weight: 600;
  }

  .flag {
    display: inline-block;
    margin-left: 0.3rem;
    padding: 0 0.35rem;
    border-radius: 0.5rem;
    background: #c0392b;
    color: #fff;
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
    font: inherit;
    color: inherit;
    background: rgba(127, 127, 127, 0.08);
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
  }

  .text {
    width: 100%;
    box-sizing: border-box;
  }

  .raw {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
    border-radius: 1rem;
    background: rgba(46, 204, 113, 0.18);
    border: 1px solid rgba(46, 204, 113, 0.4);
  }

  .chip-remove {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.15rem;
  }

  .chip-input {
    flex: 1 1 6rem;
    min-width: 5rem;
  }
</style>
