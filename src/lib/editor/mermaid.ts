import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
// `treeGrowthEffect`/`treeProgressPlugin` are re-exported from the package root
// via our patch (see patches/@atomic-editor%2Feditor@0.4.3.patch) — the package
// does not expose its `./tree-progress` subpath. We listen for the effect and
// include the plugin so fences parsed after the initial budgeted parse (long
// documents) still render, matching `imageBlocks`/`tables`.
import { treeGrowthEffect, treeProgressPlugin } from '@atomic-editor/editor';
import {
  findMermaidBlocks,
  hasMermaidBlock,
  mermaidCacheKey,
  mermaidThemeFor,
  selectionTouches,
  type MermaidBlock,
  type ResolvedTheme,
} from './mermaidBlocks';

// ---------------------------------------------------------------------------
// Mermaid block rendering (slice: mermaid-block-render, ADR-0005)
//
// Our OWN CodeMirror StateField, built ALONGSIDE atomic-editor's
// `imageBlocks`/`tables` (atomic-editor exposes no generic block-renderer seam,
// so this is a parallel, purpose-built field). It walks the syntax tree for
// `FencedCode` nodes whose info is `mermaid` (detection lives in the pure
// `mermaidBlocks.ts`), and replaces each whole fence with the rendered Diagram
// via `Decoration.replace({ block: true })`:
//
//   - cursor OUTSIDE the fence (hybrid)  -> diagram shown
//   - cursor INSIDE the fence  (hybrid)  -> replace lifted, raw fence revealed
//   - `view` mode                        -> always rendered (no reveal)
//   - `edit` mode                        -> this field is NOT in the extension
//                                           set at all, so the raw fence shows
//
// `mermaid` is LAZY-loaded via dynamic `import('mermaid')`, gated on the doc
// actually containing a mermaid block, and initialised with
// `securityLevel: 'strict'`. While the module imports / a diagram renders, a
// muted placeholder is shown.
//
// SEAMS LEFT FOR SIBLING SLICES (deliberately NOT built here):
//   - error-state:   DONE (error-state slice). A failed `mermaid.render()` now
//                    paints a bordered error panel (mermaid's message + raw
//                    source) via `buildErrorPanel`, distinct from a code block.
//   - theme-sync:    DONE (theme-sync slice). The resolved app theme is mapped
//                    (`mermaidThemeFor`) to a mermaid theme, re-applied per
//                    render via `initialize({ theme })`, and threaded into the
//                    widget key. `App.svelte` dispatches `setMermaidTheme` on a
//                    theme flip; the field rebuilds on it (like treeGrowthEffect).
//   - edit-affordance: DONE (edit-affordance slice). In hybrid the widget shows
//                    a hover hint (cursor:pointer + "✎ edit") and a double-click
//                    handler dispatches a selection INTO the fence to lift the
//                    block-replace. The global `edit` toggle stays the fallback.
//   - render-caching: DONE (render-caching slice). `WidgetType.eq()` is keyed on
//                    `(source + theme)` (DOM reuse across unrelated edits); a
//                    module-level `(source,theme)->SVG` cache paints identical
//                    diagrams instantly; a per-host generation token discards a
//                    stale in-flight render that resolves after a newer one.
// ---------------------------------------------------------------------------

/**
 * Lazily-resolved mermaid module + one-time `initialize`. The dynamic import is
 * only triggered when a document actually contains a mermaid block (the field's
 * builder calls `ensureMermaid()` only then), so diagram-free Concepts never
 * pull mermaid's large bundle. Cached as a promise so concurrent widgets share
 * one import.
 */
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

/**
 * A theme-changed signal. `App.svelte` dispatches this with the new resolved
 * theme when the app's light/dark scheme flips; the field rebuilds on it (same
 * shape as the `treeGrowthEffect` branch) so baked SVGs re-render in the new
 * theme — CSS-variable inheritance can't recolour an SVG that lives outside
 * Svelte reactivity (ADR-0005, theme-sync).
 */
export const setMermaidTheme = StateEffect.define<ResolvedTheme>();

function ensureMermaid(): Promise<typeof import('mermaid').default> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid').then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({
      // No auto-scan; we render each diagram explicitly via `render`.
      startOnLoad: false,
      // OKF bundles are shareable, so a diagram's source may be untrusted —
      // strict sanitisation (no click callbacks, no raw HTML labels) is the
      // safe default (ADR-0005). Interactivity is a later concern.
      securityLevel: 'strict',
    });
    return mermaid;
  });
  return mermaidPromise;
}

/** Monotonic id source for unique mermaid render ids (mermaid requires one). */
let renderSeq = 0;

/**
 * Module-level `(source, theme) → SVG` cache (render-caching slice, ADR-0005
 * option 9a). The field rebuilds its decoration set on every doc change — even
 * edits BETWEEN diagrams — and `mermaid.render()` is async, so an identical
 * diagram (or one edited back to a prior state) should paint instantly from
 * memory rather than re-running mermaid. Keyed by `mermaidCacheKey` so the key
 * matches `WidgetType.eq()`: same `(source + theme)` → same SVG.
 */
const svgCache = new Map<string, string>();

/**
 * Build the error-state panel for a failed `mermaid.render()` (error-state
 * slice, ADR-0005 option 4a). A bordered panel surfaces mermaid's error
 * message, with the raw fence source rendered beneath it, so the user sees both
 * what is broken and what they typed without dropping into `edit` mode. The
 * `.cm-mermaid-error` class makes a broken diagram visibly distinct from a plain
 * code block (which has no renderer). DOM-only and pure; no async.
 */
function buildErrorPanel(message: string, source: string): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cm-mermaid-error';

  const heading = document.createElement('div');
  heading.className = 'cm-mermaid-error-heading';
  heading.textContent = 'Diagram error';
  panel.appendChild(heading);

  const msg = document.createElement('div');
  msg.className = 'cm-mermaid-error-message';
  // mermaid's message is plain text; set as textContent (never innerHTML) so a
  // malicious diagram source can't smuggle markup through the error path.
  msg.textContent = message;
  panel.appendChild(msg);

  const raw = document.createElement('pre');
  raw.className = 'cm-mermaid-error-source';
  raw.textContent = source;
  panel.appendChild(raw);

  return panel;
}

/**
 * Render `source` into `host` as an SVG diagram in the given resolved app
 * `theme`. Shows a muted placeholder immediately, lazy-loads mermaid, applies
 * the theme via `initialize({ theme })`, then swaps in the SVG. On a
 * render/parse failure it replaces the placeholder with a bordered error panel
 * (mermaid's message + the raw source) — error-state slice (ADR-0005). The error
 * clears automatically when the source is fixed: the field rebuilds and
 * re-renders.
 *
 * A baked SVG cannot recolour via CSS inheritance (theme-sync, ADR-0005), so the
 * theme is applied at render time and the field rebuilds (re-rendering) on a
 * theme flip. Async and self-contained so the caching/generation-token slice can
 * wrap it without reshaping the widget.
 */
/**
 * Per-host generation token (render-caching slice). Each `renderInto` call bumps
 * the host's generation; an async render only paints if its captured generation
 * is still the host's current one. So if CM6 reuses a host DOM and a NEWER
 * render is kicked off (e.g. a fast source-change-then-revert), the older
 * in-flight render — resolving later — is discarded rather than swapped in over
 * the newer result (no stale SVG ever displayed). Keyed by the host element via
 * a WeakMap so it is GC'd with the DOM.
 */
const hostGeneration = new WeakMap<HTMLElement, number>();

function renderInto(host: HTMLElement, source: string, theme: ResolvedTheme): void {
  // Claim a fresh generation for this render; any earlier in-flight render for
  // this host is now stale and must not paint.
  const generation = (hostGeneration.get(host) ?? 0) + 1;
  hostGeneration.set(host, generation);
  const current = () => hostGeneration.get(host) === generation;

  const key = mermaidCacheKey(source, theme);

  // Cache hit: an identical diagram (same source + theme) was rendered before —
  // paint synchronously from memory, no fresh `mermaid.render()`.
  const cached = svgCache.get(key);
  if (cached !== undefined) {
    host.innerHTML = cached;
    return;
  }

  const placeholder = document.createElement('div');
  placeholder.className = 'cm-mermaid-loading';
  placeholder.textContent = 'Rendering diagram…';
  host.innerHTML = '';
  host.appendChild(placeholder);

  const id = `cm-mermaid-${renderSeq++}`;
  ensureMermaid()
    .then((mermaid) => {
      // Apply the resolved theme per render — mermaid bakes colours into the SVG
      // at `render` time, so re-`initialize` before each render keeps the diagram
      // in step with the app's light/dark scheme (ADR-0005 option 5a).
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: mermaidThemeFor(theme) });
      return mermaid.render(id, source);
    })
    .then(({ svg }) => {
      // Cache the successful render for instant repaint of identical diagrams.
      svgCache.set(key, svg);
      // Discard a stale render: only paint if THIS render is still the newest
      // for the host (generation unchanged) and the host is still mounted.
      if (!host.isConnected || !current()) return;
      host.innerHTML = svg;
    })
    .catch((err: unknown) => {
      // Surface the failure as a bordered error panel (raw source beneath the
      // message) rather than swallowing it — a half-typed diagram is invalid
      // most of the time the cursor sits just outside it (ADR-0005, 4a).
      // Errors are NOT cached: fixing the source must re-attempt the render.
      if (!host.isConnected || !current()) return;
      const message = err instanceof Error ? err.message : String(err);
      host.innerHTML = '';
      host.appendChild(buildErrorPanel(message, source));
    });
}

/**
 * The block widget that replaces a mermaid fence with its rendered Diagram.
 * Thin over `renderInto`; keyed on `(source + theme)` for DOM reuse across
 * unrelated edits, while still re-rendering on a theme flip.
 *
 * `reading` (view mode) is carried so the edit-affordance is added ONLY in
 * hybrid — view is read-only and never lifts the block-replace, so a "click to
 * edit" hint there would be a lie. It is excluded from `eq()`: the two modes use
 * separate field instances (the mode Compartment), so a single field's widgets
 * always share one `reading` value; only `(source + theme)` affect DOM reuse.
 */
class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly theme: ResolvedTheme,
    readonly reading: boolean,
  ) {
    super();
  }

  // Reuse DOM (skip re-render) when BOTH the diagram source and the resolved
  // theme are unchanged. Including the theme means a theme flip produces a
  // non-equal widget, so CM6 re-renders the diagram in the new colours; an
  // edit elsewhere (same source + theme) reuses the existing SVG (ADR-0005).
  eq(other: MermaidWidget): boolean {
    return other.source === this.source && other.theme === this.theme;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-mermaid';

    // The rendered SVG / placeholder / error panel lives in an inner element so
    // `renderInto`'s `innerHTML` swap never wipes the edit-affordance siblings
    // (the hover hint) appended to `wrap`.
    const render = document.createElement('div');
    render.className = 'cm-mermaid-render';
    wrap.appendChild(render);
    renderInto(render, this.source, this.theme);

    // Edit-affordance (ADR-0005, options 6a+6b): a `block: true` replace has no
    // source text to click into, so add a discoverable way to start editing —
    // hybrid only (view is read-only, never lifts the replace).
    if (!this.reading) {
      wrap.classList.add('cm-mermaid-editable');
      wrap.title = 'Double-click to edit diagram';

      // A subtle "click to edit" hint shown on hover (CSS reveals it).
      const hint = document.createElement('span');
      hint.className = 'cm-mermaid-edit-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.textContent = '✎ edit';
      wrap.appendChild(hint);

      // Double-click lifts the block-replace by dropping the cursor INTO the
      // fence. We resolve the fence position from the widget's CURRENT DOM
      // location (`posAtDOM`) rather than a captured offset, so it stays correct
      // even when CM6 reuses this DOM after an unrelated edit shifted the range.
      wrap.addEventListener('dblclick', (event) => {
        event.preventDefault();
        const pos = view.posAtDOM(wrap);
        // +1 nudges past the fence start so the selection sits strictly inside
        // the fence (selectionTouches treats edges as inside, but a hair inside
        // is unambiguous), reliably lifting the replace and revealing raw source.
        const target = Math.min(pos + 1, view.state.doc.length);
        view.dispatch({ selection: { anchor: target } });
        view.focus();
      });
    }

    return wrap;
  }

  // Let our own `dblclick` handler (added in `toDOM`) own double-clicks so CM6
  // does not also try to map the event to a text position under the widget
  // (there is none — the source is replaced). Other pointer events fall through
  // to CM6 so a single click near the diagram can still move the caret.
  ignoreEvent(event: Event): boolean {
    return event.type === 'dblclick';
  }
}

/**
 * Build the replace-decoration set for the current state. In `view` mode every
 * mermaid fence is replaced (always rendered). In `hybrid` a fence the
 * selection touches is LEFT as raw source (the replace is lifted) so it can be
 * edited; all others are replaced with the diagram.
 */
function buildDecorations(
  state: Parameters<typeof findMermaidBlocks>[0],
  reading: boolean,
  theme: ResolvedTheme,
): DecorationSet {
  const blocks: MermaidBlock[] = findMermaidBlocks(state);
  const ranges = [];
  for (const block of blocks) {
    // Hybrid: reveal the raw fence when the cursor is inside it.
    if (!reading && selectionTouches(state, block.from, block.to)) continue;
    ranges.push(
      Decoration.replace({
        widget: new MermaidWidget(block.source, theme, reading),
        block: true,
      }).range(block.from, block.to),
    );
  }
  return Decoration.set(ranges, true);
}

/**
 * The field's value: the replace-decoration set plus the resolved app theme it
 * was built for. The theme rides on the field value (rather than a module
 * global) so it survives across transactions and the next rebuild renders in the
 * current theme. Diagram-free states still carry the last-known theme.
 */
interface MermaidState {
  readonly deco: DecorationSet;
  readonly theme: ResolvedTheme;
}

/**
 * The mermaid StateField. Rebuilds:
 *   - on `treeGrowthEffect`, so fences parsed after the initial budgeted parse
 *     (long documents) still render — same contract as `imageBlocks`/`tables`;
 *   - on `setMermaidTheme`, so a light/dark flip re-renders baked SVGs in the new
 *     colours (theme-sync, ADR-0005) — same shape as the `treeGrowthEffect` arm;
 *   - on doc change (a fence may have been added/removed/edited);
 *   - on selection change (hybrid reveal: cursor entering/leaving a fence).
 *
 * `reading` is fixed when the field is constructed (the mode Compartment in
 * `cm.ts` rebuilds the mode-dependent slice on mode switch), so a single field
 * instance always knows whether it is the `view`-mode or `hybrid`-mode variant.
 * The theme is seeded to `'light'`; `App.svelte`'s effect dispatches the real
 * resolved theme on mount, so the first paint matches the app scheme.
 */
function mermaidField(reading: boolean): StateField<MermaidState> {
  return StateField.define<MermaidState>({
    create: (state) => ({ deco: buildDecorations(state, reading, 'light'), theme: 'light' }),
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setMermaidTheme)) {
          const theme = effect.value;
          return { deco: buildDecorations(tr.state, reading, theme), theme };
        }
        if (effect.is(treeGrowthEffect)) {
          return { deco: buildDecorations(tr.state, reading, value.theme), theme: value.theme };
        }
      }
      if (tr.docChanged || tr.selection) {
        return { deco: buildDecorations(tr.state, reading, value.theme), theme: value.theme };
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.deco),
  });
}

/** Muted loading placeholder + diagram container styling. */
const mermaidTheme = EditorView.theme({
  '.cm-mermaid': {
    position: 'relative',
    padding: '0.5rem 0',
  },
  // The inner render target (SVG / placeholder / error panel). Centres the
  // diagram; siblings (the edit hint) sit on the outer `.cm-mermaid`.
  '.cm-mermaid-render': {
    display: 'flex',
    justifyContent: 'center',
  },
  '.cm-mermaid svg': {
    maxWidth: '100%',
    height: 'auto',
  },
  // Edit-affordance (edit-affordance slice): a rendered diagram in hybrid is
  // double-clickable to reveal its raw source, so signal that with a pointer
  // cursor and a subtle hover hint. Positioned relative so the hint can anchor.
  '.cm-mermaid-editable': {
    position: 'relative',
    cursor: 'pointer',
  },
  '.cm-mermaid-edit-hint': {
    position: 'absolute',
    top: '0.35rem',
    right: '0.35rem',
    padding: '0.1rem 0.4rem',
    borderRadius: 'var(--radius-pill, 999px)',
    background: 'var(--accent, #4060d0)',
    color: 'var(--accent-contrast, #fff)',
    fontSize: '0.72em',
    fontWeight: '600',
    lineHeight: '1.4',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.12s ease',
  },
  '.cm-mermaid-editable:hover .cm-mermaid-edit-hint': {
    opacity: '1',
  },
  '.cm-mermaid-loading': {
    color: 'var(--text-muted, #888)',
    fontStyle: 'italic',
    fontSize: '0.9em',
    padding: '0.5rem 0',
  },
  // A failed render: a bordered panel (mermaid's message + the raw source
  // beneath) — deliberately distinct from a plain fenced code block so a broken
  // diagram reads as broken, not as un-highlighted code (error-state slice).
  '.cm-mermaid-error': {
    width: '100%',
    border: '1px solid var(--danger, #d33)',
    borderRadius: 'var(--radius-sm, 4px)',
    background: 'var(--danger-soft, rgba(221, 51, 51, 0.08))',
    padding: '0.6rem 0.75rem',
    boxSizing: 'border-box',
    textAlign: 'left',
  },
  '.cm-mermaid-error-heading': {
    color: 'var(--danger, #d33)',
    fontWeight: '600',
    fontSize: '0.85em',
    marginBottom: '0.35rem',
  },
  '.cm-mermaid-error-message': {
    color: 'var(--danger, #d33)',
    fontSize: '0.85em',
    whiteSpace: 'pre-wrap',
    marginBottom: '0.5rem',
  },
  '.cm-mermaid-error-source': {
    margin: '0',
    padding: '0.5rem',
    borderRadius: 'var(--radius-sm, 4px)',
    background: 'var(--bg-sunken, rgba(0, 0, 0, 0.06))',
    color: 'var(--text, inherit)',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '0.85em',
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
  },
});

// Re-export so cm.ts can gate work on whether the doc has any diagram (kept
// here so the editor builder imports a single mermaid surface).
export { hasMermaidBlock };

/**
 * The mermaid block-render extension. Wire into `modeExtensions` for `hybrid`
 * and `view` ONLY (NOT `edit` — source mode shows the raw fence). `reading` is
 * true for `view` (always rendered), false for `hybrid` (cursor reveals raw).
 *
 * Includes `treeProgressPlugin` so the field's `treeGrowthEffect` rebuild
 * actually fires on long documents (the plugin is idempotent across the other
 * block fields that also include it — CM6 dedups identical extensions).
 */
export function mermaidBlocks(reading: boolean): Extension {
  return [mermaidField(reading), mermaidTheme, treeProgressPlugin];
}
