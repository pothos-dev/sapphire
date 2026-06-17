## What to build

Make undo/redo a single unified timeline across both the markdown body and the frontmatter, using CodeMirror's history rather than a separate stack.

Frontmatter changes are already dispatched as `setFrontmatter` effects (from the split-frontmatter ticket). Register an `invertedEffects` function (from `@codemirror/commands`) that, given a transaction carrying `setFrontmatter`, returns the inverse effect built from `tr.startState.field(frontmatterField)` (the previous value). Dispatch each frontmatter action with `isolateHistory.of("full")` so it forms its own discrete undo step and never coalesces with body typing. Because body edits are ordinary document transactions in the same history, Ctrl+Z walks back through body and frontmatter changes in chronological order; redo re-applies. Granularity: one undo step per committed action (add / delete / rename-commit / scalar-commit / chip add / chip remove) — not per keystroke.

Add a global capture-phase keydown for Ctrl+Z and Ctrl+Shift+Z (and Ctrl+Y): when focus is **outside** the editor (e.g. in a Properties input), call `undo(view)` / `redo(view)` directly so the panel participates; when focus is inside the editor, let CM's own keymap handle it. Add undo/redo buttons to the Properties panel header that call the same commands (optionally disabled via `undoDepth`/`redoDepth`).

History must not cross document boundaries: on concept switch, rebuild the `EditorState` (fresh doc + fresh frontmatter field + empty history) instead of dispatching an in-place replacement.

## Acceptance criteria

- [ ] After editing the body then a property (or vice versa), repeated Ctrl+Z undoes the changes in reverse chronological order across both surfaces; redo restores them.
- [ ] Ctrl+Z / Ctrl+Shift+Z work while focus is in a Properties input (routed to `undo`/`redo` on the view).
- [ ] Each frontmatter action is a single undo step (not per keystroke); a scalar edit commits as one step on blur/Enter.
- [ ] Panel header undo/redo buttons perform the same operations.
- [ ] Switching concepts resets history — undo cannot reach back into a previously open concept.

## Blocked by

- docs/tickets/ready/split-frontmatter-out-of-editor.md
