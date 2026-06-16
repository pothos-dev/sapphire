import { EditorView, keymap, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState, Annotation, type Extension } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput } from '@codemirror/language';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
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
