import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
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
 * Slice 1: READ-ONLY (EditorState.readOnly.of(true)); editable from slice 2.
 * We do NOT use atomic-editor's `wikiLinks` — OKF uses standard markdown links
 * (slice 5 wires `inlinePreview({ onLinkClick })` to OKF navigation).
 *
 * Theme follows `prefers-color-scheme` for now (slice 9 owns the theme source):
 * we set `data-theme="light"` on the editor root when the OS prefers light.
 */
export interface BuildEditorOptions {
  parent: HTMLElement;
  doc: string;
  readOnly?: boolean;
}

function prefersLight(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

export function buildEditor({ parent, doc, readOnly = true }: BuildEditorOptions): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      inlinePreview(),
      imageBlocks(),
      tables(),
      atomicEditorTheme,
      atomicMarkdownSyntax,
      EditorState.readOnly.of(readOnly),
      // `editable` controls the DOM `contenteditable`; `readOnly` blocks edits
      // at the state level. For slice 1 we want both off so the view is truly
      // non-editable (no caret/IME). Slice 2 flips these for editing.
      EditorView.editable.of(!readOnly),
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({ state, parent });

  // Light/dark per ARCHITECTURE.md: data-theme="light" when OS prefers light.
  if (prefersLight()) {
    view.dom.setAttribute('data-theme', 'light');
  }

  return view;
}

/** Replace the document of an existing view (used when switching Concepts). */
export function setEditorDoc(view: EditorView, doc: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
  });
}
