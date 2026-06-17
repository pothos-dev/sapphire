## What to build

Today all sidebar collapse state is ephemeral local `$state` in `App.svelte` — the
whole-sidebar collapse and each Section's expanded flag reset on every launch. Move the
existing collapse state into the persisted per-Bundle session store so it survives a reload.

This slice covers only the state that exists today (the single left Sidebar and its three
Sections). It establishes the persistence pattern that the right-Sidebar and Outline slices
extend with one field each.

Persist as flat optional booleans on `BundleState` (TS type + Rust struct with serde
`camelCase` + default, mirrored in both `tauri.ts` and `fake.ts`):

- `leftSidebarOpen` — defaults `true`
- `explorerOpen` — defaults `true`
- `tagsOpen` — defaults `true`
- `backlinksOpen` — defaults `true`

The session store gains a rune + accessor per flag, includes them in `snapshot()`, and seeds
them with the defaults on `load()`. Defaulting-on-read means a fresh Bundle needs no special
seeding. The existing `restored` gate must guard these the same way it guards
`expandedFolders` — a toggle that fires mid-restore must not persist and wipe stored state.

Note: all Sections default to expanded now (previously only Explorer was open by default).

## Acceptance criteria

- [ ] `BundleState` (TS and Rust) carries `leftSidebarOpen`, `explorerOpen`, `tagsOpen`, `backlinksOpen`, all optional, tolerated when missing
- [ ] Collapsing/expanding the left Sidebar or any Section persists, and the state is restored after a reload
- [ ] A fresh Bundle (no stored state) opens with the left Sidebar expanded and all Sections expanded
- [ ] Toggles fired before restore completes do not persist or clobber stored state
- [ ] `bun run build` and `cargo check` are green
- [ ] A Playwright test toggles collapse state, reloads, and asserts it was restored, saving a screenshot

## Blocked by

None - can start immediately
