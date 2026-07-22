## What to build

Full keyboard navigation inside the Explorer, with the **Focused item** decoupled from the
open **Concept** (see `docs/GLOSSARY.md`).

- The Explorer gets a **Focused item** (a tree row) that is *independent* of the open Concept.
  Arrowing moves the Focused item without opening anything; the row matching `editor.path`
  keeps its own "open" marker. Two distinct affordances: the open Concept keeps its filled
  accent (today's `.selected`); the Focused item shows the spotlight focus ring.
- **Roving tabindex** over tree rows (exactly one `tabindex="0"` at a time; the rest `-1` — they
  are `-1` today). Clicking a row also sets the Focused item.
- Keys (operate on the Focused item):

| Key | Behavior |
|---|---|
| `↑`/`↓` (`k`/`j`) | move to prev/next **visible** row (children of collapsed folders skipped); **clamp** at ends |
| `→` (`l`) | collapsed folder → expand; expanded folder → into first child; file → no-op |
| `←` (`h`) | expanded folder → collapse; file or collapsed folder → jump to **parent** folder |
| `Enter` | file → **open** the Concept and move focus to the Editor; folder → toggle expand |
| `Home`/`End` | first / last visible row |

- Clamp (not wrap) at the ends — do **not** reuse `listNav.ts`'s wrapping `nextIndex`/`prevIndex`
  (those wrap correctly for modals, which is wrong for a spatial tree). A flattened-visible-rows
  helper is likely worth extracting (Tags reuses it in tags-multi-expand-keyboard-nav.md).
- Plays inside the focus backbone: the Explorer registers as a Region, remembers its last
  Focused item (sticky), and `Alt`+dir enters/leaves it. `h`/`j`/`k`/`l` here are *unmodified*
  and unambiguous (cross-Region move is `Alt`+`hjkl`).

## Acceptance criteria

- [ ] `↑/↓`/`j`/`k` move the Focused item across visible rows and clamp at the ends
- [ ] `→`/`←`/`l`/`h` expand, collapse, descend, and jump-to-parent per the table
- [ ] The Focused item is visually distinct from the open Concept (ring vs filled accent)
- [ ] `Enter` opens a file (focus → Editor) and toggles a folder
- [ ] Roving tabindex: exactly one tree row is tab-focusable; clicking updates the Focused item
- [ ] The Explorer's Focused item is remembered across `Alt`-away/`Alt`-back
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test arrows through the tree, expands/collapses, opens a Concept with `Enter`, and saves a screenshot showing the Focused-item vs open-Concept distinction

## Blocked by

- docs/tickets/ready/region-focus-backbone.md
