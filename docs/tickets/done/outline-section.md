## What to build

Add an Outline Section to the right Sidebar: a live list of the open Concept's markdown
headings, in document order, indented by heading level, that scrolls the editor to a heading
when clicked.

Behavior:

- Headings (`#`–`######`) are derived **live** from `editor.content`, updating as the user
  types — not only on document-open.
- The scan **skips the frontmatter block** (use the existing frontmatter helper to find where
  the body starts, so a YAML comment like `# note` is not read as an H1) and **skips fenced
  code blocks** (so a `# comment` inside a code fence is not treated as a heading).
- Each entry indents by its level (H1 flush-left, deeper levels step-indented).
- Clicking an entry scrolls the Editor pane to that heading via the existing
  `scrollToLine(view, n)`. Line numbers are tracked against the **full document**
  (frontmatter included) so the scroll target is correct.
- Empty states: muted "No Concept open" when nothing is open; muted "No headings" when the
  open Concept has none.
- No active-heading highlight in this slice (deferred follow-up) — hover/click feedback only,
  matching the other sidebar entries.

The Outline sits above Backlinks in the right Sidebar. Its collapse state persists via a new
`outlineOpen` flag on `BundleState` (defaults `true`), following the established pattern.

## Acceptance criteria

- [ ] The Outline Section lists the open Concept's headings in document order, indented by level
- [ ] The list updates live as headings are typed, edited, or removed
- [ ] Frontmatter lines and fenced-code-block lines never produce outline entries
- [ ] Clicking an entry scrolls the editor to the correct heading line
- [ ] "No Concept open" and "No headings" empty states render appropriately
- [ ] `outlineOpen` persists on `BundleState` (defaults `true`) and is restored after a reload
- [ ] `bun run build` and `cargo check` are green
- [ ] A Playwright test opens a Concept with headings, clicks an entry, asserts the scroll, and saves a screenshot

## Blocked by

- docs/tickets/ready/right-sidebar-move-backlinks.md
