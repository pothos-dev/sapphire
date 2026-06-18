## What to build

Turn the Properties Section into a keyboard-navigable spreadsheet-style grid with two columns
(**key** | **value**) and two modes. (Chip/list cells get an extra sub-navigation depth in a
separate slice — properties-chip-subnavigation.md.)

- The **Focused item** in Properties is a **cell** (the roving-tabindex element is a cell
  wrapper; the `<input>` lives inside it). Two columns: key | value.
- **Two modes**:
  - **Nav mode** — cell highlighted (focus ring on the wrapper), input *not* focused.
  - **Edit mode** — the cell's input is focused, normal text editing.
- Transitions (spreadsheet idiom):

| Key (nav mode) | Action |
|---|---|
| `↑`/`↓` | move row; **clamp** |
| `←`/`→` | move key↔value column; **clamp** |
| `Enter` / `F2` | enter **edit mode** on the focused cell |
| `a` | add a new property row, drop into **edit mode** on its key cell (matches today's new-row autofocus) |
| `d` | delete the focused row (existing per-row delete button stays for mouse) |

| Key (edit mode) | Action |
|---|---|
| `Enter` | **commit** → back to nav mode, move **down** one row |
| `Tab` | **commit** → move **right** (key→value→next row) |
| `Escape` | **cancel** draft → back to nav mode, same cell (reuses today's Escape-cancels-draft) |

- **Clipboard**: `Ctrl+C`/`Ctrl+V` work in **both** modes — edit mode is native input copy/paste;
  nav mode copies/pastes the whole cell value as a string via the clipboard API.
- **Read-only raw-YAML cells**: navigable but not editable; `Enter` just focuses the textarea
  (for select/copy), `Escape` exits. No edit mode.
- **List/chip cells**: in this slice, `Enter` may simply focus the existing chip-add input; the
  full chip sub-navigation depth is properties-chip-subnavigation.md.
- Registers as the **Properties** Region; `Alt+↑` from the Editor lands on the remembered cell in
  nav mode (sticky), or the row-1 key cell if none. Reuses today's blur-commit and draft logic.

## Acceptance criteria

- [ ] Nav mode: `↑/↓` move rows, `←/→` move key↔value, clamp at edges, input not focused
- [ ] `Enter`/`F2` enter edit mode; `Enter` commits-and-moves-down; `Tab` commits-and-moves-right; `Escape` cancels to nav
- [ ] `a` adds a row in edit mode on its key cell; `d` deletes the focused row
- [ ] `Ctrl+C`/`Ctrl+V` work in both nav mode (whole cell value) and edit mode (native)
- [ ] Read-only raw-YAML cells are navigable but not editable
- [ ] `Alt+↑` from the Editor lands on the remembered cell in nav mode
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test navigates cells, edits a value, commits with `Enter` and `Tab`, adds and deletes a row, and saves a screenshot

## Blocked by

- docs/tickets/ready/region-focus-backbone.md
