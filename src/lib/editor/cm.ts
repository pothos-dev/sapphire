import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  EditorState,
  StateField,
  Annotation,
  StateEffect,
  RangeSetBuilder,
  type Extension,
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
  invertedEffects,
  isolateHistory,
} from '@codemirror/commands';
import { indentOnInput } from '@codemirror/language';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { resolveLink } from '$lib/links';
import { joinConcept, serializeFrontmatter, type Property } from '$lib/frontmatter';
import {
  inlinePreview,
  imageBlocks,
  tables,
  atomicEditorTheme,
  atomicMarkdownSyntax,
} from '@atomic-editor/editor';
// Lazy-loaded fenced-code grammars. Each entry's `load()` is a dynamic
// `import('@codemirror/lang-*')`, so the bundler splits every grammar into its
// own chunk and only the languages actually used in a document are fetched.
import { ATOMIC_CODE_LANGUAGES } from '@atomic-editor/editor/code-languages';
import '@atomic-editor/editor/styles.css';

/**
 * Builds the CodeMirror 6 EditorView with the atomic-editor live-preview
 * extension set (ADR 0001): Obsidian-style hybrid preview where the markdown
 * source is the on-disk truth, inactive lines render styled, and the cursor
 * line shows raw markup.
 *
 * Editable (slice editing-autosave-watcher); was read-only in slice 1.
 *
 * The GFM parser (`markdown({ base: markdownLanguage, codeLanguages })`) is the
 * keystone: without `base: markdownLanguage` the parser is pure CommonMark and
 * inline-preview never sees Task / Table nodes; without `codeLanguages` fenced
 * blocks have no grammar to highlight with. The grammars load lazily (see the
 * `ATOMIC_CODE_LANGUAGES` import note).
 *
 * We do NOT use atomic-editor's `wikiLinks` — OKF uses standard markdown links.
 *
 * Theme: the editor root's `data-theme` mirrors the app root's, which is owned
 * by the theme store (`state/theme.svelte.ts`, OS-driven default). We seed it at
 * build time from the inherited `data-theme` and the app shell keeps it in sync.
 *
 * Autosave hooks: `onChange` fires on every user edit (the editor store
 * debounces it); `onBlur` fires when focus leaves the editor (flush save).
 */

/**
 * Marks a dispatch as a programmatic document replacement (Concept switch or
 * external-change reload) rather than a user edit, so the change listener does
 * NOT treat it as something to autosave back to disk.
 */
const programmatic = Annotation.define<boolean>();

// ---------------------------------------------------------------------------
// Frontmatter as editor state (ADR 0003)
//
// The CodeMirror document holds ONLY the markdown body. The Concept's
// frontmatter lives as a structured `Property[]` in `frontmatterField` — the
// single source of truth for frontmatter while a Concept is open. The Properties
// panel reads it (mirrored out via `onFrontmatterChange`) and writes it by
// dispatching `setFrontmatter`. On any change we recombine `serialize(props) +
// body` and report it through `onChange` for autosave.
//
// Dispatching frontmatter through a StateEffect (rather than rewriting the whole
// document string) is what lets the unified-undo slice layer `invertedEffects`
// on top to put frontmatter edits into the editor's history.
// ---------------------------------------------------------------------------

/** Replace the open Concept's structured frontmatter. */
export const setFrontmatter = StateEffect.define<Property[]>();

/** Holds the open Concept's frontmatter properties (body lives in the doc). */
export const frontmatterField = StateField.define<Property[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFrontmatter)) value = e.value;
    return value;
  },
});

/**
 * Unified undo (ADR 0003 / unified-body-frontmatter-undo): frontmatter lives in
 * a StateField but is mutated via `setFrontmatter` effects, which CodeMirror's
 * history does not know how to reverse on its own. `invertedEffects` teaches it:
 * for any transaction carrying a `setFrontmatter`, we register the INVERSE — a
 * `setFrontmatter` of the PRIOR field value (`tr.startState`) — so undo/redo
 * restore frontmatter exactly the way they restore document text. Body edits are
 * ordinary doc transactions in the same history, so one timeline spans both.
 */
const frontmatterUndo = invertedEffects.of((tr) => {
  // Only emit an inverse when this transaction actually changes frontmatter.
  if (!tr.effects.some((e) => e.is(setFrontmatter))) return [];
  return [setFrontmatter.of(tr.startState.field(frontmatterField))];
});

/**
 * Dispatch a USER frontmatter edit so it forms its OWN discrete undo step and
 * never coalesces with body typing. `isolateHistory.of("full")` opens a fresh
 * history event on both sides; the `setFrontmatter` effect carries the new
 * value (and `frontmatterUndo` records the inverse). NOT used for programmatic
 * concept loads — those rebuild the state with empty history (`setEditorConcept`).
 */
export function dispatchFrontmatter(view: EditorView, props: Property[]): void {
  view.dispatch({
    effects: setFrontmatter.of(props),
    annotations: isolateHistory.of('full'),
  });
}

// ---------------------------------------------------------------------------
// Broken-link decoration (slice: bundle-index-broken-links)
//
// Internal markdown links whose resolved target does NOT exist in the Bundle
// index render with a distinct `cm-broken-link` class (dashed/red — see the CSS
// below). The check is SYNCHRONOUS: it consults a caller-provided predicate
// (backed by the frontend index store's cached path set) while walking the
// syntax tree, because CodeMirror decorations cannot await IPC.
//
// Links remain fully clickable and navigable — this is styling only, never a
// block (broken links are tolerated per the OKF spec, CONTEXT.md).
//
// Freshness: the decoration re-runs on doc changes AND when the host dispatches
// `refreshBrokenLinks` (fired on the `file-changed` watcher event and on
// Concept switch, so created/removed targets restyle without a reload).
// ---------------------------------------------------------------------------

/** Context the decoration needs: which Concept is open + does a target exist. */
export interface BrokenLinkContext {
  /** bundle-relative path of the open Concept (for relative-link resolution). */
  currentPath: () => string;
  /** synchronous existence check against the index's cached path set. */
  exists: (path: string) => boolean;
}

/** Dispatch this effect to force the broken-link decoration to recompute. */
export const refreshBrokenLinks = StateEffect.define<null>();

const brokenLinkMark = Decoration.mark({ class: 'cm-broken-link' });

/** Distinct styling for broken internal links: dashed, red. Clickable still. */
const brokenLinkTheme = EditorView.theme({
  '.cm-broken-link': {
    color: 'var(--danger)',
    textDecoration: 'underline dashed var(--danger)',
    textUnderlineOffset: '2px',
  },
});

/**
 * Build the broken-link decoration set for the current viewport: walk the
 * syntax tree, find `Link` nodes, extract their URL, resolve it the same way
 * the navigation seam does (`resolveLink`), and mark the link's text range
 * broken when it resolves to an internal target absent from the index.
 */
function computeBrokenLinks(view: EditorView, ctx: BrokenLinkContext): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const currentPath = ctx.currentPath();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'Link') return;
        // A markdown Link node spans `[text](url)`. Find the `URL` child for the
        // href, and mark the whole link range so the styling covers the text.
        let href: string | null = null;
        const cursor = node.node.cursor();
        if (cursor.firstChild()) {
          do {
            if (cursor.name === 'URL') {
              href = view.state.sliceDoc(cursor.from, cursor.to);
              break;
            }
          } while (cursor.nextSibling());
        }
        if (href === null) return;
        const resolved = resolveLink(currentPath, href);
        if (resolved.kind === 'internal' && !ctx.exists(resolved.path)) {
          builder.add(node.from, node.to, brokenLinkMark);
        }
      },
    });
  }
  return builder.finish();
}

/**
 * The broken-link extension: a ViewPlugin recomputing the decoration on doc /
 * viewport changes and on an explicit `refreshBrokenLinks` effect.
 */
function brokenLinks(ctx: BrokenLinkContext): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = computeBrokenLinks(view, ctx);
      }
      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshBrokenLinks)),
        );
        if (update.docChanged || update.viewportChanged || refreshed) {
          this.decorations = computeBrokenLinks(update.view, ctx);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export interface BuildEditorOptions {
  parent: HTMLElement;
  /** The markdown BODY (no frontmatter) to seed the document with. */
  doc: string;
  /** The Concept's initial frontmatter properties (ADR 0003). */
  frontmatter?: Property[];
  /**
   * Bundle-relative path of the Concept this view starts on. Recorded so
   * `setEditorConcept` can detect a Concept SWITCH (path change) and rebuild the
   * state with a fresh history (unified-undo: history never crosses Concepts).
   */
  path?: string | null;
  readOnly?: boolean;
  /**
   * Called with the new FULL Concept markdown (`serialize(frontmatter) + body`)
   * after a user edit to either the body or the frontmatter, for autosave.
   */
  onChange?: (content: string) => void;
  /**
   * Called whenever the frontmatter field changes (user edit, Concept switch, or
   * external reload), so the Properties panel can render the current properties.
   */
  onFrontmatterChange?: (props: Property[]) => void;
  /** called when the editor loses focus */
  onBlur?: () => void;
  /**
   * Called after any transaction that may change the undo/redo history depth
   * (body edit, frontmatter edit, programmatic replacement) and after a state
   * rebuild on Concept switch. Lets the host mirror `undoDepth`/`redoDepth` into
   * reactive UI state for the Properties-panel undo/redo buttons.
   */
  onHistory?: () => void;
  /**
   * Called when the user clicks a rendered link in the live preview (inline
   * links and table-cell links). See the slice-5 seam below.
   */
  onLinkClick?: (url: string) => void;
  /**
   * Context for broken-link styling: the open Concept's path (for relative-link
   * resolution) and a synchronous existence check against the Bundle index. When
   * omitted, broken-link styling is disabled (links render normally).
   */
  brokenLinkContext?: BrokenLinkContext;
}

/**
 * Resolve the theme to seed the editor root with at build time, by reading the
 * `data-theme` set on the nearest ancestor (the app root — owned by the theme
 * store, see `state/theme.svelte.ts`). The app shell keeps this attribute in
 * sync afterwards via an `$effect`; this just avoids a flash of the wrong theme
 * on the very first build. Falls back to the OS preference if no ancestor has
 * set it yet.
 */
function inheritedTheme(parent: HTMLElement): 'light' | 'dark' {
  const fromDom = parent.closest('[data-theme]')?.getAttribute('data-theme');
  if (fromDom === 'light' || fromDom === 'dark') return fromDom;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/**
 * SLICE 5 SEAM — OKF link navigation.
 *
 * atomic-editor routes every rendered-link click (inline links + table-cell
 * link icons) through one `onLinkClick(url)` callback. For now we route to a
 * safe default: open external (http/https) URLs in a new tab, and ignore
 * relative/OKF links (`./rel.md`, `/abs.md`) rather than opening a blank tab.
 *
 * Slice 5 plugs OKF navigation in here by passing its own `onLinkClick` via
 * `BuildEditorOptions` — it resolves the OKF path against the open Concept and
 * navigates in-app. No restructuring needed: just provide the callback.
 */
function defaultLinkClick(url: string): void {
  if (typeof window === 'undefined') return;
  // External links: open in a new tab. Relative / OKF links are left for
  // slice 5; opening them as URLs here would be wrong, so we no-op.
  if (/^https?:\/\//i.test(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  // else: relative/OKF link — TODO(slice 5): resolve + navigate in-app.
}

// ---------------------------------------------------------------------------
// In-Concept Find & Replace (slices: in-concept-find / in-concept-replace)
//
// We mount @codemirror/search's BUILT-IN panel ABOVE the editor (`top: true`)
// rather than hand-rolling a Svelte panel. Defaults give us case-insensitive
// literal find (`caseSensitive: false`, `literal: false`/regexp off) with the
// case / whole-word / regexp toggles still present, and replace / replace-all
// for free. Replace flows through ordinary doc transactions, so it rides the
// existing autosave (`onChange`) and CM undo/redo with no new persistence path.
//
// Scope is the body only: the CodeMirror doc holds only the body (frontmatter
// lives in `frontmatterField`, ADR 0003), so find/replace never touch it.
//
// `Ctrl/Cmd+F` is owned by App.svelte (so it grabs focus app-wide); the search
// keymap here still provides in-panel bindings (Enter = next, Esc = close, etc.)
// and the other find affordances. App calls `openSearch(view)` to open + focus.
//
// The panel is themed below with Sapphire's design tokens so it reads as editor
// chrome (matching the nav bar / inputs) rather than CM's default grey panel.
// ---------------------------------------------------------------------------

/** Theme the built-in search panel with Sapphire's design tokens. */
const findPanelTheme = EditorView.theme({
  '.cm-panel.cm-search': {
    padding: '0.4rem 0.6rem',
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.85rem',
  },
  '.cm-panel.cm-search label': {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    marginLeft: '0.2rem',
  },
  '.cm-panel.cm-search .cm-textfield': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.2rem 0.4rem',
    fontFamily: 'var(--font-ui)',
  },
  '.cm-panel.cm-search .cm-textfield:focus-visible': {
    outline: 'none',
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 2px var(--accent-soft)',
  },
  '.cm-panel.cm-search .cm-button': {
    backgroundColor: 'var(--bg)',
    backgroundImage: 'none',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.2rem 0.55rem',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search .cm-button:hover': {
    backgroundColor: 'var(--hover)',
  },
  '.cm-panel.cm-search .cm-button:focus-visible': {
    outline: 'none',
    boxShadow: '0 0 0 2px var(--accent-soft)',
  },
  '.cm-panel.cm-search [name=close]': {
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search [name=close]:hover': {
    color: 'var(--text)',
  },
});

/**
 * The find extension set: the built-in search panel mounted above the editor
 * plus its keymap. Tagging the panel with `data-testid` is done in
 * `openSearch`, since the built-in `SearchPanel` class is not exported.
 */
function findExtensions(): Extension[] {
  return [search({ top: true }), keymap.of(searchKeymap)];
}

/**
 * Open (and focus) the in-Concept find panel for `view`. Called by App.svelte's
 * `Ctrl/Cmd+F` handler so the binding works from anywhere in the app. Seeding
 * the find field from the current selection is the built-in panel's default.
 * Also tags the panel DOM with `data-testid` hooks for e2e selection.
 */
export function openSearch(view: EditorView): void {
  openSearchPanel(view);
  // The built-in panel renders synchronously into the DOM; tag it (and its
  // fields) for stable e2e selection. Idempotent: re-tagging is harmless.
  const panel = view.dom.querySelector('.cm-search');
  if (panel) {
    panel.setAttribute('data-testid', 'find-panel');
    panel.querySelector('[name=search]')?.setAttribute('data-testid', 'find-input');
    panel.querySelector('[name=replace]')?.setAttribute('data-testid', 'replace-input');
    panel.querySelector('[name=next]')?.setAttribute('data-testid', 'find-next');
    panel.querySelector('[name=prev]')?.setAttribute('data-testid', 'find-prev');
    panel.querySelector('button[name=replace]')?.setAttribute('data-testid', 'find-replace');
    panel.querySelector('[name=replaceAll]')?.setAttribute('data-testid', 'find-replace-all');
    panel.querySelector('[name=close]')?.setAttribute('data-testid', 'find-close');
  }
}

/** The atomic-editor live-preview extension set, shared by build paths. */
function livePreviewExtensions(onLinkClick: (url: string) => void): Extension[] {
  return [
    // GFM markdown parser with lazy code-block grammars. MUST come before the
    // decoration extensions so they can read Task / Table / FencedCode nodes.
    markdown({ base: markdownLanguage, codeLanguages: ATOMIC_CODE_LANGUAGES }),
    atomicMarkdownSyntax,
    atomicEditorTheme,
    tables({ onLinkClick }),
    imageBlocks(),
    inlinePreview({ onLinkClick }),
  ];
}

/**
 * Everything BELOW the frontmatter field in the extension list: the live-preview
 * set, broken-link styling, history, keymaps and the change/blur listeners.
 * Shared verbatim by the initial build AND by `setEditorConcept`'s state rebuild
 * on Concept switch, so the two cannot drift. The frontmatter field is seeded
 * separately by each caller (the value differs), but the BEHAVIOUR is here.
 */
function editorExtensions(opts: Omit<BuildEditorOptions, 'parent' | 'doc' | 'frontmatter'>): Extension[] {
  const { readOnly = false, onChange, onFrontmatterChange, onBlur, onHistory, onLinkClick, brokenLinkContext } = opts;

  // Notify on user edits to the body OR the frontmatter. Frontmatter edits are
  // carried by `setFrontmatter` effects (no doc change), so we watch for both.
  // Debouncing happens in the store.
  const changeListener = EditorView.updateListener.of((update) => {
    const fmChanged = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(setFrontmatter)),
    );
    if (!update.docChanged && !fmChanged) return;
    // History depth may have changed (body/frontmatter edit, undo, redo); keep
    // the host's reactive undo/redo state in sync for the panel buttons.
    onHistory?.();
    // Mirror the frontmatter out on every field change (incl. programmatic
    // Concept switches / reloads) so the Properties panel stays in sync.
    if (fmChanged) onFrontmatterChange?.(update.state.field(frontmatterField));
    if (!onChange) return;
    // Skip programmatic replacements (Concept switch / external reload).
    const isProgrammatic = update.transactions.some((tr) => tr.annotation(programmatic));
    if (isProgrammatic) return;
    onChange(joinConcept(update.state.field(frontmatterField), update.state.doc.toString()));
  });

  // Save-on-blur: flush any pending autosave when focus leaves the editor.
  const blurListener = EditorView.domEventHandlers({
    blur: () => {
      onBlur?.();
      return false;
    },
  });

  return [
    ...livePreviewExtensions(onLinkClick ?? defaultLinkClick),
    // In-Concept Find & Replace: built-in search panel (mounted above the
    // editor) + its keymap, themed as editor chrome. Ctrl/Cmd+F is opened by
    // App.svelte via `openSearch`; the keymap supplies in-panel bindings.
    ...findExtensions(),
    findPanelTheme,
    // Broken-link styling (only when the index context is provided). Placed
    // after the live-preview extensions so its mark class layers on top of
    // atomic-editor's `.cm-atomic-link` decoration.
    ...(brokenLinkContext ? [brokenLinks(brokenLinkContext), brokenLinkTheme] : []),
    // Editing affordances that make the hybrid preview feel like Obsidian.
    history(),
    // Unified undo: record the inverse of each frontmatter mutation so the
    // editor history can undo/redo frontmatter alongside body edits.
    frontmatterUndo,
    drawSelection(),
    indentOnInput(),
    closeBrackets(),
    highlightActiveLine(),
    keymap.of([
      ...closeBracketsKeymap,
      ...historyKeymap,
      ...markdownKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    // `editable` controls the DOM `contenteditable`; `readOnly` blocks edits
    // at the state level. Editable from this slice on for autosave.
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.lineWrapping,
    changeListener,
    blurListener,
  ];
}

/**
 * The build options behind a view, kept so `setEditorConcept` can rebuild the
 * EditorState (fresh history) on Concept switch using the SAME extension set /
 * listeners — without the caller having to thread the options back in.
 */
const viewOptions = new WeakMap<EditorView, BuildEditorOptions>();

/** Which Concept path each view is currently showing (for switch detection). */
const viewPath = new WeakMap<EditorView, string | null>();

export function buildEditor(options: BuildEditorOptions): EditorView {
  const { parent, doc, frontmatter = [] } = options;
  const state = EditorState.create({
    doc,
    extensions: [
      // Seed the frontmatter field with the open Concept's properties.
      frontmatterField.init(() => frontmatter),
      ...editorExtensions(options),
    ],
  });

  const view = new EditorView({ state, parent });
  viewOptions.set(view, options);
  viewPath.set(view, options.path ?? null);

  // Seed the editor root's theme from the app root (the theme store keeps it in
  // sync afterwards). atomic-editor reads `data-theme` on the CodeMirror root.
  view.dom.setAttribute('data-theme', inheritedTheme(parent));

  return view;
}

/**
 * Replace an existing view's body + frontmatter (switching Concepts, or
 * reloading after an external change).
 *
 * Unified-undo (this slice): history must NOT cross Concept boundaries. When the
 * `path` differs from what the view last showed, we REBUILD the EditorState from
 * scratch (`view.setState`) with the new body, a freshly-seeded frontmatter
 * field, and a brand-new `history()` — so undo can never reach back into the
 * previously-open Concept. The rebuild reuses the same shared `editorExtensions`
 * (so listeners keep working) and seeds the field directly (NOT via a
 * `setFrontmatter` effect), which also means the rebuild fires no autosave: a
 * fresh state with no user transaction produces no `onChange` call.
 *
 * When the path is UNCHANGED (external reload of the open Concept, or a body
 * self-edit reflow), we keep the in-place dispatch path: each half updates only
 * when it actually changed (no pointless transactions / cursor disruption), and
 * the dispatch is marked `programmatic` so it is NOT autosaved back. Editing the
 * SAME doc therefore keeps coalescing in the existing history as before.
 */
export function setEditorConcept(
  view: EditorView,
  body: string,
  props: Property[],
  path: string | null = null,
): void {
  const prevPath = viewPath.get(view) ?? null;
  const switched = path !== prevPath;
  viewPath.set(view, path);

  if (switched) {
    // Fresh state = fresh history. No history can survive the Concept boundary.
    const options = viewOptions.get(view);
    view.setState(
      EditorState.create({
        doc: body,
        extensions: [
          frontmatterField.init(() => props),
          ...(options ? editorExtensions(options) : []),
        ],
      }),
    );
    // Mirror the new frontmatter out: a state rebuild fires no update listener,
    // so push it to the Properties panel explicitly. History was reset to empty,
    // so refresh the host's undo/redo state too.
    options?.onFrontmatterChange?.(props);
    options?.onHistory?.();
    return;
  }

  const docChanged = view.state.doc.toString() !== body;
  const fmChanged =
    serializeFrontmatter(view.state.field(frontmatterField)) !== serializeFrontmatter(props);
  if (!docChanged && !fmChanged) return;
  view.dispatch({
    changes: docChanged
      ? { from: 0, to: view.state.doc.length, insert: body }
      : undefined,
    effects: fmChanged ? [setFrontmatter.of(props)] : [],
    annotations: programmatic.of(true),
  });
}

/**
 * Force the broken-link decoration to recompute (e.g. after the Bundle index's
 * existing-path set changed on a `file-changed` event, or after switching
 * Concepts). Cheap no-op dispatch carrying the `refreshBrokenLinks` effect.
 */
export function refreshBrokenLinkDecorations(view: EditorView): void {
  view.dispatch({ effects: refreshBrokenLinks.of(null) });
}

/**
 * Scroll the editor to (and place the cursor at the start of) `line`, a 1-based
 * line number. Used by full-text search to reveal the matching line after
 * opening a Concept. Clamps out-of-range lines (the doc may differ slightly
 * from the searched snapshot). Marked programmatic so the selection change is
 * not mistaken for a user edit.
 */
export function scrollToLine(view: EditorView, line: number): void {
  const total = view.state.doc.lines;
  const clamped = Math.max(1, Math.min(line, total));
  const pos = view.state.doc.line(clamped).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    annotations: programmatic.of(true),
  });
}
