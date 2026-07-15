// Client-side Mermaid Diagram hydration for the web viewer
// (slice: web-mermaid-diagrams).
//
// The server leaves ` ```mermaid ` fences as inert code (comrak emits
// `<pre><code class="language-mermaid">source</code></pre>`); this island scans
// the rendered Concept HTML for those blocks and renders each into a Diagram in
// the browser — the read-only web analogue of the desktop's live-preview
// Diagram. It REUSES the desktop's theming (`mermaidThemeConfig`) + cache-key
// (`mermaidCacheKey`) from the CM-free `editor/mermaidTheme` module, and mirrors
// its behaviour: lazy `import('mermaid')`, `securityLevel: 'strict'`, the app's
// own palette/font baked in per theme, and a graceful bordered error panel on a
// malformed diagram (never breaking the page).

import {
  mermaidThemeConfig,
  mermaidCacheKey,
  type ResolvedTheme,
} from '../editor/mermaidTheme';

/** Map the OS `prefers-color-scheme` match to the app's resolved theme. Pure. */
export function resolvedTheme(prefersDark: boolean): ResolvedTheme {
  return prefersDark ? 'dark' : 'light';
}

/**
 * Lazily-resolved mermaid module + one-time `initialize`. The dynamic import is
 * only triggered when a Concept actually contains a diagram (hydrate finds a
 * block), so diagram-free Concepts never pull mermaid's large bundle. Cached as
 * a promise so concurrent renders share one import.
 */
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function ensureMermaid(): Promise<typeof import('mermaid').default> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid').then((mod) => {
    const mermaid = mod.default;
    // OKF bundles are shareable, so a diagram's source may be untrusted —
    // strict sanitisation (no click callbacks, no raw HTML labels) is the safe
    // default (ADR-0005). No auto-scan; we render each explicitly.
    // `suppressErrorRendering` stops mermaid from injecting its OWN error graph
    // into the DOM on a parse failure — we render our own in-place error panel.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
    return mermaid;
  });
  return mermaidPromise;
}

/** Monotonic id source for unique mermaid render ids (mermaid requires one). */
let renderSeq = 0;

/** Module-level `(source, theme) → SVG` cache (see `mermaidCacheKey`). */
const svgCache = new Map<string, string>();

/**
 * Per-host generation token: each render bumps the host's generation; an async
 * render only paints if its captured generation is still current. So a newer
 * render (e.g. a fast theme flip / re-nav) discards a stale earlier one.
 */
const hostGeneration = new WeakMap<HTMLElement, number>();

/** CSS class marking a hydrated diagram container (the source rides on it). */
const CONTAINER_CLASS = 'web-mermaid';

/**
 * Hydrate/render every mermaid Diagram inside `root` in the given `theme`.
 *
 * Two idempotent passes:
 *   1. Convert each fresh `<pre><code class="language-mermaid">` into a
 *      `.web-mermaid` container carrying the source on a data attribute (so a
 *      later theme re-render can re-render it without the original code block).
 *   2. Render (or re-render) every `.web-mermaid` container in `theme`.
 *
 * Safe to call repeatedly: on Concept navigation the `{@html}` swap produces
 * fresh code blocks (pass 1 handles them); on a theme flip the containers
 * already exist (pass 2 re-renders them in the new palette). A malformed diagram
 * shows a bordered error panel in place — it never throws out of here.
 */
export async function hydrateMermaid(root: HTMLElement, theme: ResolvedTheme): Promise<void> {
  // Pass 1: convert fresh code blocks into stable containers.
  for (const code of Array.from(root.querySelectorAll('code.language-mermaid'))) {
    const pre = code.closest('pre') ?? code;
    const container = document.createElement('div');
    container.className = CONTAINER_CLASS;
    container.dataset.mermaidSource = code.textContent ?? '';
    const render = document.createElement('div');
    render.className = 'web-mermaid-render';
    container.appendChild(render);
    pre.replaceWith(container);
  }

  // Resolve the app palette/font from the themed root NOW (mermaid bakes colours
  // into the SVG at render time). `read` is the injected CSS-var reader.
  const cs = getComputedStyle(root);
  const read = (name: string) => cs.getPropertyValue(name).trim();

  // Pass 2: render every container in the current theme.
  const containers = Array.from(root.querySelectorAll<HTMLElement>(`.${CONTAINER_CLASS}`));
  await Promise.all(
    containers.map((container) => {
      const source = container.dataset.mermaidSource ?? '';
      const target = container.querySelector<HTMLElement>('.web-mermaid-render') ?? container;
      return renderOne(target, source, theme, read);
    }),
  );
}

/**
 * Render one diagram `source` into `host` in `theme`. Cache hit paints instantly;
 * otherwise lazy-load mermaid, apply the app-palette theme, render, and swap in
 * the SVG. A failure shows a bordered error panel (message + raw source as
 * textContent — never innerHTML). Discards its result if a newer render for the
 * host superseded it.
 */
async function renderOne(
  host: HTMLElement,
  source: string,
  theme: ResolvedTheme,
  read: (name: string) => string,
): Promise<void> {
  const generation = (hostGeneration.get(host) ?? 0) + 1;
  hostGeneration.set(host, generation);
  const current = () => hostGeneration.get(host) === generation;

  const key = mermaidCacheKey(source, theme);
  const cached = svgCache.get(key);
  if (cached !== undefined) {
    host.innerHTML = cached;
    return;
  }

  const themeConfig = mermaidThemeConfig(read, theme);

  const placeholder = document.createElement('div');
  placeholder.className = 'web-mermaid-loading';
  placeholder.textContent = 'Rendering diagram…';
  host.innerHTML = '';
  host.appendChild(placeholder);

  const id = `web-mermaid-${renderSeq++}`;
  try {
    const mermaid = await ensureMermaid();
    // Theme with the app's own palette/font per render (mermaid bakes colours in).
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      ...themeConfig,
    });
    const { svg } = await mermaid.render(id, source);
    svgCache.set(key, svg);
    if (!host.isConnected || !current()) return;
    host.innerHTML = svg;
  } catch (err: unknown) {
    // Belt-and-suspenders: remove any temporary render element mermaid may have
    // left appended to the document on failure (in addition to
    // `suppressErrorRendering`), so no orphan diagram lingers in the page.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    if (!host.isConnected || !current()) return;
    const message = err instanceof Error ? err.message : String(err);
    host.innerHTML = '';
    host.appendChild(buildErrorPanel(message, source));
  }
}

/**
 * A bordered error panel for a failed render: mermaid's message with the raw
 * source beneath, so a broken diagram reads as broken (not as un-highlighted
 * code) without breaking the page. DOM-only; message + source set as
 * textContent so a malicious source can't smuggle markup through the error path.
 */
function buildErrorPanel(message: string, source: string): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'web-mermaid-error';
  panel.setAttribute('data-testid', 'mermaid-error');

  const heading = document.createElement('div');
  heading.className = 'web-mermaid-error-heading';
  heading.textContent = 'Diagram error';
  panel.appendChild(heading);

  const msg = document.createElement('div');
  msg.className = 'web-mermaid-error-message';
  msg.textContent = message;
  panel.appendChild(msg);

  const raw = document.createElement('pre');
  raw.className = 'web-mermaid-error-source';
  raw.textContent = source;
  panel.appendChild(raw);

  return panel;
}
