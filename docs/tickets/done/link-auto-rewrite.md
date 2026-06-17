## What to build

Automatically rewrite links when a Concept or folder is renamed or moved, so links stay intact. This is deliberately chosen over the OKF spec's broken-link tolerance for an Obsidian-like experience; the behavior is two-directional and path-aware.

- **Inbound links** (other Concepts → the moved one): rewrite their targets. Absolute `/links` get the new absolute path; relative `./links` are recomputed relative to each source's own location. (Inbound sources come from the index's reverse map.)
- **The moved Concept's own outbound relative links**: rewrite them, because the file's base path changed. Its absolute links are unaffected.
- **Folder moves**: apply the same logic to every contained Concept.
- All rewrites go through the normal write path and update the index.

Note: this edits files the user did not explicitly open. Make the scope of edits clear (e.g. a summary of "N links in M files updated").

Type: **AFK**.

## Acceptance criteria

- [ ] Moving/renaming a Concept rewrites all inbound links (absolute and relative) to keep them valid
- [ ] The moved Concept's own relative outbound links are rewritten; its absolute links are untouched
- [ ] Moving a folder correctly rewrites links for all contained Concepts
- [ ] After a move, the index and broken-link styling show no newly-broken links that auto-rewrite could have fixed
- [ ] The user is shown a summary of how many links/files were changed

## Blocked by

- tree-crud.md
- bundle-index-broken-links.md
