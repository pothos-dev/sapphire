## What to build

Keyboard navigation for the two read-only list Regions in the right Sidebar: **Outline** and
**Backlinks**. Both are flat, navigate-and-open lists.

- Roving tabindex over list items; register as the **Outline** and **Backlinks** Regions; sticky
  Focused-item memory.
- Keys (both Regions):

| Key | Behavior |
|---|---|
| `↑`/`↓` (`k`/`j`) | move Focused item; **clamp** at ends |
| `Enter` | activate (see per-Region action below) |

- **Outline** `Enter` → scroll the Editor to that heading (existing `scrollToLine`) **and move
  focus to the Editor**.
- **Backlinks** `Enter` → open that Concept (routes through navigation/history, focus → Editor).
- No CRUD verbs — navigate-and-open only.
- Existing mouse click behavior is preserved.

## Acceptance criteria

- [ ] `↑/↓/j/k` move the Focused item in both Regions and clamp at the ends
- [ ] Outline `Enter` scrolls the Editor to the heading and focuses the Editor
- [ ] Backlinks `Enter` opens the linked Concept (focus → Editor)
- [ ] Both register as Regions with sticky Focused-item memory and roving tabindex
- [ ] Mouse click still works in both
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test arrows through Outline and Backlinks, activates an item in each, and saves a screenshot

## Blocked by

- docs/tickets/ready/region-focus-backbone.md
