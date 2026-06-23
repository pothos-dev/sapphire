## What to build

Render ` ```mermaid ` fenced code blocks as diagrams in the editor, per
[ADR-0005](../../adr/0005-mermaid-block-rendering.md). This is the tracer bullet: a complete
render path through every layer, with the polish (errors, theming, edit affordance, caching)
following in sibling slices.

Add a `mermaidBlocks()` CodeMirror `StateField` extension alongside atomic-editor's
`imageBlocks`/`tables` (atomic-editor exposes no generic block-renderer seam, so this is a
parallel, purpose-built field). Behaviour:

- A pure `.ts` module detects `FencedCode` nodes whose info string is `mermaid` and returns
  their source and document ranges — kept separate from the DOM/render shell so it is
  unit-testable, following the `path.ts`/`outline.ts` convention.
- `mermaid` is **lazy-loaded** via dynamic `import('mermaid')`, only when the open document
  actually contains a mermaid block, and initialised with `securityLevel: 'strict'`.
- The whole fence is replaced with the rendered diagram via `Decoration.replace({ block: true })`:
  cursor outside the block → diagram only; cursor inside (hybrid) → the replace lifts to reveal
  the raw fence for editing; `edit` mode → always raw; `view` mode → always rendered.
- While the module imports / the diagram renders, show a muted loading placeholder.
- The field rebuilds on atomic-editor's `treeGrowthEffect` so blocks parsed after the initial
  budgeted parse (long documents) still render.

Editing in this slice is via arrowing into the block or the global `edit`-mode toggle; the
discoverable hover/double-click affordance is a later slice. Error and theme handling are also
later slices — for now an invalid diagram may simply fail to paint, and the diagram renders with
mermaid's default theme.

Type: **AFK**.

## Acceptance criteria

- [ ] A ` ```mermaid ` block renders as a diagram in `view` and `hybrid` (cursor outside) modes
- [ ] Placing the cursor inside the block (hybrid) reveals the raw fence; `edit` mode always shows raw source
- [ ] A non-mermaid fenced block (e.g. ` ```python `) is unaffected and still renders as a code block
- [ ] `mermaid` is only fetched when the document contains a mermaid block (lazy dynamic import)
- [ ] Diagrams render with `securityLevel: 'strict'`
- [ ] A muted placeholder shows while the module/diagram is loading
- [ ] The pure block-detection logic lives in a plain `.ts` module with `bun test` unit coverage (mermaid block detected, non-mermaid ignored, correct ranges)
- [ ] `bun run check` and `cargo check` are green
- [ ] A Playwright test opens a Concept with a valid mermaid block, asserts an SVG renders, and saves a screenshot

## Blocked by

- None - can start immediately
