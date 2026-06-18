## What to build

Replace "skip all hidden Regions" (from region-focus-backbone.md) with **transient auto-reveal**
for Regions that are hidden *by a collapse*, while still skipping truly absent/empty ones.

- Each collapsible has its persisted `expanded` state (manual) plus an ephemeral
  `transientlyRevealed` flag. **Visible = `expanded || transientlyRevealed`.**
- Directional focus *into* a collapse-hidden Region sets `transientlyRevealed = true` and lands
  focus in it. This applies at whichever level was hidden:
  - whole **Sidebar** collapsed → the Sidebar transiently opens;
  - a **Section** accordion-collapsed → just that Section transiently opens.
- Focus *leaving* the Region clears `transientlyRevealed`, snapping back to the persisted state.
  A Region only **stays** open if it was manually `expanded` **before** you arrived (no in-visit
  "pin").
- **Survives an overlay round-trip**: opening and then cancelling an overlay (e.g. QuickNav)
  that returns focus to the peeked Region must **not** collapse it. It collapses only when focus
  truly leaves the Region. (Coordinate with escape-peel-restore-opener.md.)
- **Skip, don't reveal**, Regions that are genuinely absent/empty: Properties with no open
  Concept, Tags with no tags.

## Acceptance criteria

- [ ] `Alt`+dir toward a collapsed Sidebar/Section transiently reveals it and lands focus inside
- [ ] Leaving the Region re-collapses it iff it was not manually expanded beforehand
- [ ] A manually-expanded Region stays open after focus leaves
- [ ] A peeked Region survives an overlay open/cancel round-trip without collapsing
- [ ] Absent (no Concept → Properties) and empty (no tags → Tags) Regions are still skipped
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test reveals a collapsed Section via `Alt`+dir, leaves, asserts it re-collapsed, then repeats with a manually-expanded Section asserting it stays — and saves a screenshot

## Blocked by

- docs/tickets/ready/region-focus-backbone.md
