# CodeMirror 6 hybrid live preview via atomic-editor

We build the editor on **CodeMirror 6 with Obsidian-style hybrid live preview** (markdown
source is the source of truth; inactive lines render styled, the cursor line shows raw
markup) rather than a true-WYSIWYG editor (Milkdown/Tiptap on ProseMirror). The live-preview
decoration layer — the hard, custom part — is provided by **`@atomic-editor/editor`** (MIT),
whose CM6 extensions (live-preview decorations, table/image widgets, lazy syntax
highlighting) we consume directly; we skip its React wrapper since CM6 extensions are
framework-agnostic and mount into a Svelte-managed `EditorView`. On top we write our own thin
OKF-specific link and frontmatter extensions.

## Considered Options

- **CM6 hybrid (chosen)** — most faithful to "Obsidian-like"; markdown stays the on-disk truth.
- **Milkdown / Tiptap WYSIWYG** — less custom work but hides markup and, for Tiptap, round-trips
  markdown through a non-markdown document model (lossy risk for frontmatter and OKF quirks).
- **Bespoke live preview on raw `@codemirror/*`** — full control but the single largest cost in
  the project; `@atomic-editor/editor` already solves it.

## Consequences

- We take a dependency on a young (Nov 2025), single-maintainer project. Mitigation: it's MIT
  and its extensions are composable, so we can vendor or replace pieces if it stalls.
- atomic-editor ships `[[wiki link]]` support, but OKF uses standard markdown links
  (`/abs.md`, `./rel.md`), so we do not use its link extension — we write our own.
