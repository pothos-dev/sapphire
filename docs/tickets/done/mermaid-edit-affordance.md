## What to build

Give the user a discoverable way to start editing a rendered diagram in hybrid mode (per options
6a + 6b in [ADR-0005](../../adr/0005-mermaid-block-rendering.md)).

Because a `block: true` replace decoration swallows its source, there is no text to click into —
the cursor lands adjacent to the widget. Add affordances that dispatch a selection *into* the
fence so the replace lifts:

- A hover affordance on the diagram widget: `cursor: pointer` plus a subtle "click to edit" hint
  or edit icon.
- A double-click handler on the widget that dispatches a cursor into the fence range, lifting the
  replace and revealing the raw source.

The global `edit`-mode toggle remains the always-available fallback.

Type: **AFK**.

## Acceptance criteria

- [ ] Hovering a rendered diagram shows a pointer cursor and an edit hint/icon
- [ ] Double-clicking a diagram places the cursor inside the fence and reveals the raw source (hybrid mode)
- [ ] The `edit`-mode toggle still reveals raw source for the block
- [ ] `bun run check` and `cargo check` are green
- [ ] A Playwright test double-clicks a rendered diagram and asserts the raw fence is revealed for editing

## Blocked by

- docs/tickets/ready/mermaid-block-render.md
