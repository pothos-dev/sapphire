## What to build

Single-letter keybindings that trigger the existing tree CRUD dialogs on the Explorer's
**Focused item**, so create/rename/move/delete never require the mouse.

- When the Explorer is the active Region and a Focused item exists, these keys fire the
  *existing* `TreeCrud` dialogs (no new dialogs — reuse what the context menu already opens):

| Key | Action | Alias |
|---|---|---|
| `r` | Rename the Focused item | `F2` |
| `d` | Delete (existing confirm dialog) | `Delete` |
| `a` | New Concept | — |
| `A` | New Folder | — |
| `m` | Move (existing folder-select modal) | — |

- **New target rule**: Focused item is a folder → create *inside* it; Focused item is a file →
  create as a *sibling* (in its parent folder).
- **Focus on commit/cancel**: committing a CRUD action returns focus to the Explorer at the
  affected row (the renamed/created node becomes the Focused item); cancelling restores focus to
  the Explorer where it was (this is the "restore-to-opener" behavior — coordinate with
  escape-peel-restore-opener.md if it lands first, otherwise restore to the Explorer Region).
- **Inline rename is out of scope** — rename uses the existing modal. (Deliberate fast-follow.)
- These keys must not fire while focus is inside a text input (they are reserved for tree-row
  Focused items, which are not inputs).

## Acceptance criteria

- [ ] `r`/`F2`, `d`/`Delete`, `a`, `A`, `m` open the correct existing dialog for the Focused item
- [ ] `a`/`A` target inside a focused folder, or the parent of a focused file
- [ ] Committing rename/create/move/delete returns focus to the Explorer at the affected row
- [ ] Delete still asks for confirmation (existing dialog)
- [ ] The verbs do not fire when focus is in a text input
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test focuses a tree row, renames via `r`, creates via `a`, deletes via `d`, and saves a screenshot

## Blocked by

- docs/tickets/ready/explorer-keyboard-nav.md
