## What to build

Add a right Sidebar mirroring the left one, and move the Backlinks Section into it.

The right Sidebar is a second `<aside>` reusing the existing `SidebarSection` accordion
(its own stack, its own `--expanded-count`, the same width→0 collapse animation, anchored so
its inner content slides out to the right edge). The app shell grid goes from `auto 1fr` to
`auto 1fr auto` (left Sidebar | Editor pane | right Sidebar).

Backlinks moves out of the left Sidebar and becomes the right Sidebar's content. After this
slice the left Sidebar holds Explorer + Tags; the right Sidebar holds Backlinks (Outline is
added in a later slice). The Backlinks Section keeps its `data-testid="backlinks-section"` —
it is relocated, not renamed.

The right Sidebar **starts collapsed**. Its collapse state persists via a new
`rightSidebarOpen` flag on `BundleState` (defaults `false`), following the pattern established
in the persistence slice.

A mirrored toggle button sits in the nav-bar's currently-empty right track
(`data-testid="right-sidebar-toggle"`) — same SVG as the left `sidebar-toggle` but with the
filled accent rectangle on the right edge, titled to reflect Outline & Backlinks.

Existing Playwright tests that drive the Backlinks Section must first expand the right Sidebar
(Backlinks now lives in a collapsed Sidebar).

## Acceptance criteria

- [ ] A right Sidebar renders as a second accordion `<aside>`; app grid is `auto 1fr auto`
- [ ] Backlinks is shown in the right Sidebar and no longer in the left; left Sidebar shows Explorer + Tags
- [ ] The right Sidebar starts collapsed on a fresh Bundle; the nav-bar right-track toggle expands/collapses it with the slide animation
- [ ] `rightSidebarOpen` persists on `BundleState` (defaults `false`) and is restored after a reload
- [ ] Backlinks still opens Concepts through navigation/history and refreshes on the index `version`
- [ ] Existing Backlinks tests pass against the new location; `bun run build` and `cargo check` are green
- [ ] A Playwright test expands the right Sidebar and exercises Backlinks, saving a screenshot

## Blocked by

- docs/tickets/ready/persist-sidebar-collapse-state.md
