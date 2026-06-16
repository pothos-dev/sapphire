## What to build

Full-text (body content) search across the Bundle, backed by Rust scanning on demand.

- A search affordance (Ctrl+Shift+F) opens a query input.
- Rust searches Concept bodies on demand using ripgrep's libraries (the `ignore` + `grep-searcher` crates — no external binary dependency).
- Results list matching Concepts with a line/snippet; selecting a result opens that Concept (ideally at the match).

Type: **AFK**.

## Acceptance criteria

- [ ] Ctrl+Shift+F opens full-text search
- [ ] Queries scan Concept bodies across the Bundle and return matches with snippets
- [ ] Selecting a result opens the Concept at (or near) the match
- [ ] Search uses ripgrep crates in Rust, not a shelled-out binary
- [ ] Large bundles remain responsive (search is on demand, not blocking the UI)

## Blocked by

- editing-autosave-watcher.md
