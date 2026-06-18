## What to build

Add the third focus depth to Properties **list/chip cells** (tags and other list-valued
properties), so individual chips are keyboard-navigable.

A list/chip cell now has three focus depths:

1. **Grid nav** — the value cell is the Focused item (from properties-grid-navigation.md).
2. **Chip sub-nav** — `Enter` on the cell drops in; focus lands on the **first chip** (or the
   new-tag input if there are no chips). `←/→` move focus across the strip
   `[chip][chip]…[+ new-tag input]`. `↑/↓` are **inert** here.
   - On a **chip**: `d` deletes it (focus → neighbor chip); `Enter` does **nothing**.
   - On the **new-tag input**: `Enter` focuses it for typing → depth 3.
3. **Text edit** — typing in the new-tag input; `Enter` commits the chip (today's behavior).

- `Escape` peels exactly one layer per press: text-edit → chip sub-nav → grid nav.
- Existing mouse behavior for chips (add/remove) is preserved.

## Acceptance criteria

- [ ] `Enter` on a chip cell enters chip sub-nav on the first chip (or new-tag input if empty)
- [ ] `←/→` move across chips and the new-tag input; `↑/↓` are inert in the strip
- [ ] `d` deletes the focused chip and moves focus to a neighbor; `Enter` on a chip does nothing
- [ ] `Enter` on the new-tag input enters text edit; typing + `Enter` commits a new chip
- [ ] `Escape` peels one layer at a time (text-edit → chip sub-nav → grid nav)
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test navigates chips, deletes one with `d`, adds one via the new-tag input, peels back out with `Escape`, and saves a screenshot

## Blocked by

- docs/tickets/ready/properties-grid-navigation.md
