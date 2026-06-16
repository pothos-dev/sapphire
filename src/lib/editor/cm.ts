import { EditorView } from '@codemirror/view';
import { EditorState, Annotation } from '@codemirror/state';
import {
  inlinePreview,
  imageBlocks,
  tables,
  atomicEditorTheme,
  atomicMarkdownSyntax,
} from '@atomic-editor/editor';
import '@atomic-editor/editor/styles.css';

/**
 * Builds the CodeMirror 6 EditorView with the atomic-editor live-preview
 * extension set (ADR 0001).
 *
 * Editable (slice editing-autosave-watcher); was read-only in slice 1.
 * We do NOT use atomic-editor's `wikiLinks` — OKF uses standard markdown links
 * (slice 5 wires `inlinePreview({ onLinkClick })` to OKF navigation).
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
}

function prefersLight(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

export function buildEditor({
  parent,
  doc,
  readOnly = false,
  onChange,
  onBlur,
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
      inlinePreview(),
      imageBlocks(),
      tables(),
      atomicEditorTheme,
      atomicMarkdownSyntax,
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
