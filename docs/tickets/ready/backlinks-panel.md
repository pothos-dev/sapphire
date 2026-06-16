## What to build

A backlinks panel showing which Concepts link to the currently focused Concept, using the index's reverse map.

- For the open Concept, list every Concept that links to it.
- Each entry is clickable and opens that source Concept (respecting navigation history).
- The panel updates as the focused Concept changes and as the index updates.

Type: **AFK**.

## Acceptance criteria

- [ ] The panel lists all Concepts whose body links to the focused Concept
- [ ] Clicking a backlink opens that source Concept
- [ ] The list updates when the focus changes or when links change on disk
- [ ] An empty state is shown when there are no backlinks

## Blocked by

- bundle-index-broken-links.md
