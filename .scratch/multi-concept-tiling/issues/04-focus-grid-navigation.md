# 04 — Focus grid navigation

**What to build:** Keyboard focus moves between tiles. The editor area stays a
single logical `'editor'` Region that internally owns a 2D pane grid: `Alt+Left/
Right` moves between columns, `Alt+Up/Down` between tiles within a column. When
movement would leave the grid's edge (e.g. `Alt+Left` from the leftmost column),
it delegates to the existing Region backbone to cross into the sidebars — exactly
as the single editor does today. Leaving a column and returning lands on the tile
you were last on there (sticky per-column memory); returning from a sidebar lands
on the last active tile. The `RegionId` enum and everything keyed on it are
untouched — all tiling movement lives in a pure `paneNav.ts` module.

**Blocked by:** 03 — Tiling, dividers, Split & close.

**Status:** in-progress

- [ ] `Alt+Left/Right` moves focus between columns; `Alt+Up/Down` moves between
      tiles within the current column; the active pane is the focused tile.
- [ ] At the grid edge, `Alt+arrow` delegates to the Region backbone (leftmost →
      Explorer/Tags sidebar, rightmost → Outline/Backlinks sidebar) as today.
- [ ] Sticky per-column last-tile memory: leaving and re-entering a column lands
      on the previously-focused tile there.
- [ ] Returning from a sidebar lands on the last active tile.
- [ ] Movement math lives in a pure, unit-tested `paneNav.ts`; `regionGrid`'s
      `RegionId` enum and its dependents are unchanged.
- [ ] `paneNav.ts` unit tests, `bun test src/lib`, `bun run check`, `cargo test`,
      `cargo check` green; a Playwright spec drives keyboard movement across a
      multi-column layout and into the sidebars, saving a screenshot.
