## What to build

The complete `Escape` model and overlay focus-return behavior, layering over the basic
`Escape`→Editor from region-focus-backbone.md.

- **`Escape` peels exactly one layer**, innermost first:
  1. **In-field edit** active (e.g. a Properties draft) → cancel the draft, **stay** in the Region.
  2. **Overlay open** (QuickNav, Search, context menu, CM Find) → close it.
  3. **Non-Editor Region** focused, nothing above → **home to Editor**.
  4. **Editor** focused, nothing open → no-op.
- **Overlay focus return** splits by outcome:
  - **Cancel** (`Escape`, backdrop click) → **restore focus to the opener** — the Region (and its
    remembered Focused item) that was active when the overlay opened. Cancelling changes nothing,
    so you land exactly where you left. Overlays must record the opener Region on open (they do
    not today).
  - **Commit** (`Enter`/click a result) → focus **follows the action**: opening a Concept →
    Editor; a CRUD action committed from the context menu → Explorer at the affected row.
- This must cooperate with transient-region-auto-reveal.md: a peeked Region survives the overlay
  round-trip (cancel restores into it without collapsing).

Applies to the existing overlays: QuickNav (`Ctrl+K`), Search (`Ctrl+Shift+F`), the tree context
menu, and CodeMirror's Find panel.

## Acceptance criteria

- [ ] `Escape` peels one layer per press in the order: in-field edit → overlay → Region → Editor
- [ ] Cancelling an overlay restores focus to the opener Region at its remembered Focused item
- [ ] Committing an overlay moves focus to the action target (Concept→Editor, CRUD→Explorer row)
- [ ] Opening + cancelling an overlay from a peeked Region leaves that Region revealed
- [ ] Behavior holds for QuickNav, Search, the context menu, and CM Find
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test opens QuickNav from the Explorer, cancels, asserts focus restored to the Explorer row; opens again, commits, asserts focus in the Editor — and saves a screenshot

## Blocked by

- docs/tickets/ready/region-focus-backbone.md
