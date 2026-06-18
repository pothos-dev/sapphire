## What to build

Make the Tags Section a fully keyboard-navigable two-level tree (tag roots → tagged-Concept
leaves), reusing the Explorer's tree-navigation behavior, and convert it to **multi-expand**.

- **Multi-expand refactor** of `TagBrowser.svelte`: today only one tag expands at a time
  (`activeTag: string | null`). Change to an **expanded-set** (`Set<string>`) so multiple tags
  stay open simultaneously, matching the Explorer's folders. The single `concepts` array
  becomes a **per-tag cache** (query `backend.conceptsByTag` on each expand, keyed by tag;
  keep the existing `version`-signal re-query behavior).
- **Keyboard navigation** reuses the Explorer's flattened-visible-rows tree helper:

| Key | Behavior |
|---|---|
| `↑`/`↓` (`k`/`j`) | move Focused item across visible rows (tag roots + expanded concept leaves); clamp |
| `→` (`l`) | collapsed tag → expand; expanded tag → into first concept; leaf → no-op |
| `←` (`h`) | leaf or collapsed tag → jump to parent tag; expanded tag → collapse |
| `Enter` | tag → toggle expand; **concept leaf → open** the Concept (focus → Editor) |

- **Navigate-and-open only** — no CRUD verbs in Tags (tags derive from Concept frontmatter).
- Registers as the **Tags** Region; roving tabindex; sticky Focused-item memory.
- The existing mouse behavior (click tag to toggle, click concept to open) keeps working, now
  against the multi-expand model.

## Acceptance criteria

- [ ] Multiple tags can be expanded at once; expanding one no longer collapses another
- [ ] Per-tag concept lists are cached and re-query on the index `version` signal
- [ ] `↑/↓/j/k`, `→/←/l/h`, and `Enter` behave per the table; clamp at ends
- [ ] Opening a concept leaf moves focus to the Editor
- [ ] No CRUD verbs are active in the Tags Region
- [ ] Mouse toggle/open still work under the multi-expand model
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test expands two tags at once, arrows into a concept leaf, opens it, and saves a screenshot

## Blocked by

- docs/tickets/ready/explorer-keyboard-nav.md
