## What to build

Obsidian-style hybrid live preview in the editor, per ADR 0001.

Integrate the `@atomic-editor/editor` CodeMirror 6 extensions (the low-level exports, NOT its React wrapper) into the Svelte-mounted `EditorView`:

- Inactive lines render styled (headings sized, bold/italic/code styled); the cursor's line shows raw markup.
- Rendered table widget, image widgets (local image paths resolved against the Bundle), and lazy-loaded syntax highlighting for fenced code.
- Markdown source remains the source of truth on disk (GFM flavor).

Do NOT use atomic-editor's `[[wiki link]]` extension — OKF uses standard markdown links, handled in a separate slice.

Type: **AFK**.

## Acceptance criteria

- [ ] Headings, bold, italic, inline code, and lists render styled on inactive lines
- [ ] Placing the cursor on a styled line reveals its raw markdown markup, with no layout jump
- [ ] Fenced code blocks are syntax-highlighted; tables render as a table widget
- [ ] Local images referenced in the body render inline, resolved relative to the Bundle/Concept
- [ ] The on-disk file remains plain GFM markdown after editing

## Blocked by

- editing-autosave-watcher.md
