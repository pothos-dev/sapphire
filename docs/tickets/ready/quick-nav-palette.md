## What to build

A quick-navigation palette bound to Ctrl+K.

- Ctrl+K opens a centered palette.
- Typing fuzzy-matches against Concept paths (bundle-relative) from the index; Enter opens the highlighted match in the focused pane (respecting navigation history).
- With empty input, the palette shows recent files, navigable with ↑/↓; Enter opens the highlighted one.
- Recent files are per-Bundle state persisted via the app-data store (capped, ~15). They are never written into the Bundle.

Type: **AFK**.

## Acceptance criteria

- [ ] Ctrl+K opens the palette; Escape closes it
- [ ] Typing fuzzy-matches bundle-relative Concept paths; Enter opens the selection
- [ ] Empty input shows recent files, arrow-navigable, Enter opens
- [ ] Recent files persist across relaunch (per Bundle) and are capped
- [ ] Opening from the palette respects back/forward history

## Blocked by

- bundle-index-broken-links.md
- config-theme-state-store.md
