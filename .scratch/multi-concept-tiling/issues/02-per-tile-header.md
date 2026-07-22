# 02 — Per-tile header (single pane)

**What to build:** The pane grows a slim header carrying everything that is
logically *per-pane*. From the user's view: each open Concept shows a compact
header with its title, a close affordance, split affordances (Split Right / Split
Down, wired but a no-op until 03), the view-mode toggle (Source / Live / Reading),
undo/redo, the review-diff toggle, and Export-PDF. The NavBar loses those controls
and keeps only truly global ones (Search, Quick-nav, theme, sidebar toggles, and
the new global Properties toggle placeholder). Still exactly one pane on screen.

Notably: **undo/redo is decoupled from the Properties panel** (today it rides on
the Properties view by historical accident) and **view-mode moves up from the
bottom-right corner of the pane into the header**.

**Blocked by:** 01 — Document/Pane state split.

**Status:** ready-for-agent

- [ ] A per-pane header renders above the editor with: Concept title, close,
      Split Right / Split Down affordances, view-mode toggle, undo/redo,
      review-diff toggle, Export-PDF.
- [ ] Undo/redo act on the pane's Document history and are no longer wired
      through the Properties panel; disabling `canUndo`/`canRedo` still works.
- [ ] View-mode toggle lives in the header (removed from the bottom-right corner)
      and still persists per the existing mechanism for the single pane.
- [ ] The NavBar retains only global controls (Search, Quick-nav, theme, sidebar
      toggles) plus a global Properties show/hide toggle (may be inert until 05).
- [ ] `bun test src/lib`, `bun run check`, `cargo test`, `cargo check` green;
      a Playwright spec drives the header controls and saves a screenshot.
