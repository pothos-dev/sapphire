<script lang="ts">
  import { onMount } from 'svelte';
  import { backend } from '$lib/ipc';
  import type { RenderPayload } from '$lib/types';
  import { hydrateMermaid } from '$lib/web/webMermaid';
  import { conceptTitle } from '$lib/web/conceptUrl';

  // Chrome-free print/PDF preview of a single Concept, opened in its OWN
  // window/tab (never inside the app shell). Two modes:
  //
  //  - `toolbar = false` (web): a bare tab rendering just the Concept body. It
  //    auto-invokes `window.print()` once ready, so the BROWSER's native print
  //    → Save-as-PDF preview is the inspection surface (it already carries
  //    print/save controls, so we add none).
  //  - `toolbar = true` (desktop, opened as a separate Tauri window): the same
  //    body under a small toolbar offering Print / Save-as-PDF plus font-size
  //    and margin controls — WebKitGTK has no rich PDF chrome of its own.
  //
  // Both render the SAME server-quality HTML via `backend.renderConcept` and
  // reuse the shared `rendered.css`, so the printed page matches the web viewer.

  interface Props {
    path: string;
    toolbar: boolean;
  }
  let { path, toolbar }: Props = $props();

  let bodyEl = $state<HTMLElement | null>(null);
  let error = $state<string | null>(null);
  let ready = $state(false);

  // --- Reader controls (toolbar mode only) --------------------------------
  // Font size scales the whole rendered body; margins drive BOTH the on-screen
  // paper padding and the real `@page` margin at print time (injected below).
  let fontSize = $state(16); // px
  const MARGINS = { narrow: '10mm', normal: '18mm', wide: '25mm' } as const;
  type MarginKey = keyof typeof MARGINS;
  let margin = $state<MarginKey>('normal');
  const marginValue = $derived(MARGINS[margin]);

  // Reactive `@page { margin }` — @page can't read CSS custom props, so we keep
  // a live stylesheet element in sync with the chosen margin.
  let pageStyleEl: HTMLStyleElement | null = null;
  $effect(() => {
    const m = marginValue;
    if (!pageStyleEl) {
      pageStyleEl = document.createElement('style');
      document.head.appendChild(pageStyleEl);
    }
    pageStyleEl.textContent = `@page { margin: ${m}; }`;
  });

  onMount(() => {
    let cancelled = false;
    void (async () => {
      let payload: RenderPayload;
      try {
        payload = await backend.renderConcept(path);
      } catch (e) {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
        return;
      }
      if (cancelled || !bodyEl) return;
      bodyEl.innerHTML = payload.html;
      // Force light Mermaid — dark diagrams read wrong / waste ink on paper.
      await hydrateMermaid(bodyEl, 'light');
      if (cancelled) return;
      // Name the window/tab after the Concept so the saved PDF is sensibly named.
      document.title = conceptTitle(path, payload);
      ready = true;
      // Web tab: hand straight to the browser's print → Save-as-PDF preview.
      if (!toolbar) window.print();
    })();
    return () => {
      cancelled = true;
      pageStyleEl?.remove();
      pageStyleEl = null;
    };
  });

  function decFont() {
    fontSize = Math.max(10, fontSize - 1);
  }
  function incFont() {
    fontSize = Math.min(28, fontSize + 1);
  }
</script>

<svelte:head>
  <title>Print — Sapphire</title>
</svelte:head>

<div class="print-view" data-testid="print-view" data-toolbar={toolbar ? '1' : '0'}>
  {#if toolbar}
    <nav class="print-toolbar" aria-label="Print controls">
      <button
        type="button"
        class="pt-btn primary"
        data-testid="print-action"
        disabled={!ready}
        onclick={() => window.print()}
      >Print / Save as PDF</button>

      <div class="pt-group" aria-label="Font size">
        <span class="pt-label">Font</span>
        <button type="button" class="pt-btn" data-testid="font-dec" aria-label="Smaller font" onclick={decFont}>A−</button>
        <span class="pt-value" data-testid="font-size">{fontSize}px</span>
        <button type="button" class="pt-btn" data-testid="font-inc" aria-label="Larger font" onclick={incFont}>A+</button>
      </div>

      <div class="pt-group" aria-label="Margins">
        <span class="pt-label">Margins</span>
        <select class="pt-select" data-testid="margin-select" bind:value={margin} aria-label="Page margins">
          <option value="narrow">Narrow</option>
          <option value="normal">Normal</option>
          <option value="wide">Wide</option>
        </select>
      </div>
    </nav>
  {/if}

  <div class="print-surface">
    {#if error}
      <p class="print-error" data-testid="print-error">Cannot render {path}: {error}</p>
    {:else}
      <article
        class="print-page rendered"
        data-testid="print-body"
        style="font-size: {fontSize}px; padding: {marginValue};"
        bind:this={bodyEl}
      ></article>
    {/if}
  </div>
</div>

<style>
  .print-view {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-sunken, #eceef1);
    color: var(--text, #222);
    font-family: var(--font-ui, system-ui, sans-serif);
  }

  .print-toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 0.5rem 0.9rem;
    background: var(--bg-elevated, #f9fafc);
    border-bottom: 1px solid var(--border, #e2e2e2);
  }

  .pt-group {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .pt-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted, #777);
  }

  .pt-value {
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
    min-width: 2.6rem;
    text-align: center;
    color: var(--text-muted, #555);
  }

  .pt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.9rem;
    height: 1.9rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border, #ccc);
    border-radius: var(--radius-sm, 6px);
    background: var(--bg, #fff);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .pt-btn:hover:not(:disabled) {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .pt-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .pt-btn.primary {
    font-weight: 600;
    background: var(--accent, #1a3a6b);
    color: #fff;
    border-color: transparent;
  }

  .pt-btn.primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .pt-select {
    height: 1.9rem;
    border: 1px solid var(--border, #ccc);
    border-radius: var(--radius-sm, 6px);
    background: var(--bg, #fff);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    padding: 0 0.4rem;
    cursor: pointer;
  }

  .print-surface {
    flex: 1 1 auto;
    overflow: auto;
    min-height: 0;
    padding: 1.5rem;
    display: flex;
    justify-content: center;
  }

  /* An on-screen sheet of "paper": a centred white column so the preview mirrors
     the printed page. `padding` (the margin) + `font-size` are set inline. */
  .print-page {
    width: 100%;
    max-width: 210mm; /* A4 width */
    align-self: flex-start;
    background: #fff;
    color: #111;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
    box-sizing: border-box;
  }

  .print-error {
    color: var(--danger, #c0392b);
  }

  /* --- Print → paper -------------------------------------------------------
     Only the Concept body prints: drop the toolbar + the on-screen sheet
     scaffolding, force the LIGHT palette on white (dark paper wastes ink and
     reads wrong), and keep block backgrounds via print-color-adjust. The real
     page margin is applied through the live `@page` rule injected in script. */
  @media print {
    .print-view {
      display: block;
      height: auto;
      background: #fff;
      /* Force the light token palette whatever the OS/user theme. */
      --bg: #fff;
      --bg-elevated: #fff;
      --bg-sunken: #f2f2f2;
      --text: #111;
      --text-muted: #444;
      --border: #ccc;
      --accent: #1a3a6b;
      color: #111;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }

    .print-toolbar {
      display: none !important;
    }

    .print-surface {
      display: block;
      overflow: visible;
      padding: 0;
    }

    .print-page {
      max-width: none;
      box-shadow: none;
      /* Margin is owned by `@page` at print time; drop the on-screen padding. */
      padding: 0 !important;
    }

    /* Don't strand a heading at a page bottom; don't split code blocks, tables
       or diagrams across a page boundary. Body HTML is injected (unscoped), so
       these are `:global`. */
    .print-page :global(h1),
    .print-page :global(h2),
    .print-page :global(h3),
    .print-page :global(h4) {
      break-after: avoid;
    }

    .print-page :global(pre),
    .print-page :global(table),
    .print-page :global(.web-mermaid) {
      break-inside: avoid;
    }

    /* CriticMarkup: force the light-paper palette (dark tints wash out on white);
       explicit colours so print-color-adjust: exact keeps them. */
    .print-page :global(.critic-highlight) {
      background-color: rgba(255, 208, 0, 0.35);
    }
    .print-page :global(ins.critic-add) {
      color: #1a7f37;
      background-color: rgba(26, 127, 55, 0.14);
    }
    .print-page :global(del.critic-del) {
      color: #b3261e;
      background-color: rgba(179, 38, 30, 0.12);
    }
  }
</style>
