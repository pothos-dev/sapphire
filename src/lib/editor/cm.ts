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
  Annotation,
  StateEffect,
  RangeSetBuilder,
  type Extension,
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput } from '@codemirror/language';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { resolveLink } from '$lib/links';
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
 * Theme follows `prefers-color-scheme` for now (slice 9 owns the theme source):
 * we set `data-theme="light"` on the editor root when the OS prefers light.
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
    color: '#c0392b',
    textDecoration: 'underline dashed #c0392b',
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
  doc: string;
  readOnly?: boolean;
  /** called with the new document text after a user edit */
  onChange?: (doc: string) => void;
  /** called when the editor loses focus */
  onBlur?: () => void;
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

function prefersLight(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
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

export function buildEditor({
  parent,
  doc,
  readOnly = false,
  onChange,
  onBlur,
  onLinkClick,
  brokenLinkContext,
}: BuildEditorOptions): EditorView {
  // Notify on user edits (doc changes), debouncing happens in the store.
  const changeListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged || !onChange) return;
    // Skip programmatic replacements (Concept switch / external reload).
    const isProgrammatic = update.transactions.some((tr) => tr.annotation(programmatic));
    if (isProgrammatic) return;
    onChange(update.state.doc.toString());
  });

  // Save-on-blur: flush any pending autosave when focus leaves the editor.
  const blurListener = EditorView.domEventHandlers({
    blur: () => {
      onBlur?.();
      return false;
    },
  });

  const state = EditorState.create({
    doc,
    extensions: [
      ...livePreviewExtensions(onLinkClick ?? defaultLinkClick),
      // Broken-link styling (only when the index context is provided). Placed
      // after the live-preview extensions so its mark class layers on top of
      // atomic-editor's `.cm-atomic-link` decoration.
      ...(brokenLinkContext ? [brokenLinks(brokenLinkContext), brokenLinkTheme] : []),
      // Editing affordances that make the hybrid preview feel like Obsidian.
      history(),
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
    ],
  });

  const view = new EditorView({ state, parent });

  // Light/dark per ARCHITECTURE.md: data-theme="light" when OS prefers light.
  if (prefersLight()) {
    view.dom.setAttribute('data-theme', 'light');
  }

  return view;
}

/**
 * Replace the document of an existing view (switching Concepts, or reloading
 * after an external change). Marked programmatic so it is NOT autosaved back.
 * No-op when the doc already matches, to avoid pointless transactions and
 * cursor disruption on a reload of identical content.
 */
export function setEditorDoc(view: EditorView, doc: string): void {
  if (view.state.doc.toString() === doc) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
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
