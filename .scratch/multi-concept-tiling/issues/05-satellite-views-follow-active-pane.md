# 05 — Satellite views follow the active pane

**What to build:** The panels that describe "the open Concept" now describe the
**active pane's** Concept. Outline and Backlinks (right Sidebar) update as focus
moves between tiles. Properties is reworked: instead of collapsible chrome that
always occupies space, it becomes **embedded per tile but gated by a single global
show/hide toggle** (in the NavBar), defaulting to **hidden** (zero space when
off). When on, every visible tile shows its own Concept's frontmatter inline; a
Concept open in multiple tiles edits consistently via the shared Document.

**Blocked by:** 03 — Tiling, dividers, Split & close. (04 not strictly required —
the active pane is defined by focus, which a click already sets.)

**Status:** done

- [ ] Outline and Backlinks reflect the active pane's Concept and update when the
      active pane changes (click or keyboard).
- [ ] Properties frontmatter renders inline within each tile only when the global
      Properties toggle is on; when off, tiles show no Properties chrome at all
      (no header row, zero height cost).
- [ ] The global Properties toggle flips visibility for all visible tiles at once
      and its state persists (replaces the old per-section `propertiesOpen`).
- [ ] Editing frontmatter of a Concept shown in multiple tiles updates every such
      tile (shared Document).
- [ ] `bun test src/lib`, `bun run check`, `cargo test`, `cargo check` green;
      a Playwright spec toggles Properties globally and verifies Outline/Backlinks
      track the active pane, saving a screenshot.
