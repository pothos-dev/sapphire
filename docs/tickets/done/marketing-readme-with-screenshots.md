## What to build

Replace the README with marketing-oriented documentation that positions Sunstone and shows it off.

Positioning and content:

- **Pitch** — a lightweight markdown editor; a slimmed-down Obsidian. Fast, focused, no bloat.
- **Open any folder** — emphasise that Sunstone runs against *any* folder of markdown files. There is no proprietary "vault" concept to opt into; point it at an existing directory and edit.
- **Google OKF support** — call out first-class support for the Google **Open Knowledge Format (OKF)** and link to it: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/ (spec/repo link as appropriate). Briefly explain why it matters (portable, agent-readable, vendor-neutral typed-concept markdown bundles).
- **Feature highlights** — a short, scannable list drawn from what already ships (live preview, wikilinks + backlinks, frontmatter/properties panel, tag browser, full-text search, quick-nav palette, light/dark theming).
- **Screenshots** — embed **both light and dark mode** screenshots of the running app. Capture them from a real run against a sample markdown folder (the existing `examples/` content is a good subject), store under a docs/assets (or similar) path, and reference them in the README.

The app icon (sunstone gem) can be used as a logo/hero at the top.

## Acceptance criteria

- [ ] README markets Sunstone as a lightweight, slimmed-down-Obsidian markdown editor
- [ ] States clearly that it opens any markdown folder with no vault requirement
- [ ] OKF support is described and linked
- [ ] Feature highlights reflect features that actually ship
- [ ] One light-mode and one dark-mode screenshot are committed and render in the README
- [ ] README uses the Sunstone name throughout (no "emerald")

## Blocked by

- docs/tickets/ready/rename-app-to-sunstone.md
- docs/tickets/ready/retheme-to-sunstone-palette.md
