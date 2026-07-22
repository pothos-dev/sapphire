# 03 — Tiling, dividers, Split & close

**What to build:** The editor area becomes a **row of columns**, each column a
**vertical stack of tiled Concept panes** (all visible, no tabs). Split Right adds
a new column to the right holding a clone of the active pane's Concept; Split Down
adds a pane below it in the current column. Dividers between columns and between
tiles are draggable to resize (hand-rolled — nested flex + pointer-drag, backed by
a pure `paneLayout.ts` size-math module; no third-party layout/docking library).
The same Concept may be open in multiple tiles at once, sharing one Document
(edits/autosave in one reflect in all). Closing a tile focuses a neighbour (next
pane in the column, else the adjacent column); closing the last tile returns to
the empty-editor state. Opening a Concept (Explorer/link/search/quick-nav) still
replaces the **active** pane and pushes **that pane's** history. Mouse-driven only
(keyboard grid nav is 04).

**Blocked by:** 01 — Document/Pane state split; 02 — Per-tile header.

**Status:** ready-for-agent

- [ ] Editor area renders a row of columns, each a vertical stack of tiled panes;
      rows need not align across columns.
- [ ] Split Right opens the active Concept in a new column to the right; Split
      Down opens it in a new pane below in the current column.
- [ ] Column and intra-column dividers are draggable to resize, with sane
      min sizes; size math lives in a pure, unit-tested `paneLayout.ts`.
- [ ] The same Concept open in multiple tiles shares one Document: an edit or
      autosave in one tile is reflected in the others.
- [ ] Closing a non-last tile focuses a neighbour; closing the last tile returns
      to the empty-editor (Explorer-only) state.
- [ ] Opening a Concept replaces the active pane and pushes that pane's own
      history; other tiles are untouched.
- [ ] `paneLayout.ts` unit tests, `bun test src/lib`, `bun run check`,
      `cargo test`, `cargo check` green; a Playwright spec splits, resizes and
      closes tiles and saves a screenshot.
