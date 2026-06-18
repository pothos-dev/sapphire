import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import type { Property } from '$lib/frontmatter';

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
 *
 * This MUST be added to the extension list AFTER `history()` (see
 * `editorExtensions`) and must stay paired with `frontmatterField` — splitting
 * the two, or re-ordering relative to `history()`, can silently break undo.
 */
export const frontmatterUndo: Extension = invertedEffects.of((tr) => {
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
