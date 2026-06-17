## What to build

Hide the Tags Section entirely when the Bundle carries no tags — not every Bundle uses tags,
and an always-present empty Tags Section is noise.

`App.svelte` queries `backend.allTags()` reactively, keyed on `indexStore.version` (exactly
the pattern already used for `backend.allTypes()` → `bundleTypes`). When the result is empty,
the Tags `SidebarSection` is not rendered, and it is excluded from the left Sidebar's
`--expanded-count` so the remaining Sections share height correctly.

This is live: tags appearing (a Concept gains a tag) or disappearing (the last tag removed)
flips the Section's visibility on the next index refresh, with no bespoke refresh path. The
persisted `tagsOpen` flag is retained across hide/show — hiding does not reset it.

## Acceptance criteria

- [ ] When the Bundle has no tags, the Tags Section is absent from the left Sidebar
- [ ] When the Bundle has at least one tag, the Tags Section renders as before
- [ ] Visibility updates live as the first tag is added / the last tag removed (via the index `version` signal)
- [ ] The hidden Tags Section is excluded from `--expanded-count`; visible Sections share height correctly
- [ ] `tagsOpen` is preserved across hide/show cycles
- [ ] `bun run build` and `cargo check` are green
- [ ] A Playwright test covers both the empty-Bundle (hidden) and tagged-Bundle (visible) cases, saving a screenshot

## Blocked by

- docs/tickets/ready/persist-sidebar-collapse-state.md
