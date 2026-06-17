## What to build

In-Concept **Find**: an editor-local find panel docked above the Editor pane, distinct from the cross-Bundle **Search** modal (see CONTEXT.md).

Wire the already-present `@codemirror/search` package into the editor:

- `Ctrl/Cmd+F` is intercepted in App.svelte so it grabs focus from anywhere and opens the find panel (the editor component exposes a method App can call, e.g. `openSearch()`, which calls `openSearchPanel(view)` and focuses it). It is a **no-op when no Concept is open**.
- The panel mounts **above** the editor (`top: true`) and is themed with Sapphire's CSS variables so it reads as editor chrome (not the centered modal).
- The find field seeds from the current selection on open.
- All matches highlight; the current match scrolls into view; next/prev navigation works; Esc closes the panel and returns focus to the editor.
- Default semantics are **case-insensitive literal**. The case / whole-word / **regex** toggles are present (kept available at single-Concept scope — blast radius is one undoable file, unlike the literal-only cross-Bundle Search).

Find operates on the CodeMirror document, which is the **body only** — frontmatter lives in a separate field (ADR 0003) and is not searched here.

Known, accepted limitation: because atomic-editor conceals markup on inactive lines, the "highlight-all" overlay is best-effort over concealed syntax; navigating onto a match reveals it (the active line renders raw). Do not fight atomic-editor's decorations.

Type: **AFK**.

## Acceptance criteria

- [ ] `Ctrl/Cmd+F` opens the find panel above the editor and focuses the find field, grabbing focus from anywhere in the app.
- [ ] `Ctrl/Cmd+F` is a no-op when no Concept is open.
- [ ] Opening with an active selection seeds the find field with it.
- [ ] Matches highlight; current match scrolls into view; next/prev navigate; Esc closes and refocuses the editor.
- [ ] Default search is case-insensitive literal; case / whole-word / regex toggles are present and functional.
- [ ] The panel is styled with Sapphire's design tokens, consistent with editor chrome.
- [ ] Find is scoped to the body; frontmatter is not matched.

## Blocked by

- None - can start immediately
