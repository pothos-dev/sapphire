## What to build

Make rendered diagrams follow the app's light/dark theme and recolour when the theme flips (per
option 5a in [ADR-0005](../../adr/0005-mermaid-block-rendering.md)).

A rendered diagram is a baked SVG with colours fixed at render time, inside a CodeMirror
`StateField` that lives outside Svelte's reactivity — so CSS-variable inheritance cannot recolour
it, and the field will not rebuild just because `data-theme` changed. Therefore:

- At render, map `theme.resolved` to a mermaid theme (`'dark'` → mermaid `'dark'`, `'light'` →
  mermaid `'default'`). Keep this mapping in the pure `.ts` module so it is unit-testable.
- Add an `$effect` in `App.svelte` (next to the existing `data-theme` effect) that dispatches a
  theme-changed `StateEffect` into the editor; the `mermaidBlocks` field listens for it and
  rebuilds, exactly as it already rebuilds on `treeGrowthEffect`. Existing diagrams recolour on
  toggle.

Type: **AFK**.

## Acceptance criteria

- [ ] Diagrams render with the mermaid theme matching the current `theme.resolved`
- [ ] Flipping the OS/app theme recolours already-rendered diagrams without an edit or reopen
- [ ] The `resolved → mermaid theme` mapping is covered by a `bun test` unit test
- [ ] `bun run check` and `cargo check` are green
- [ ] A Playwright test renders a diagram, toggles theme, and asserts the diagram re-rendered for the new theme

## Blocked by

- docs/tickets/ready/mermaid-block-render.md
