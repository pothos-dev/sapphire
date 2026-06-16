## What to build

The in-memory Bundle index in Rust, plus its first consumer: broken-link styling.

- On startup, walk the Bundle into an in-memory index: for each Concept, its parsed frontmatter and its outbound links. Maintain a reverse map (target → sources) for backlinks.
- The watcher keeps the index current: a changed/created/deleted file reindexes incrementally.
- Expose query commands the frontend can call (lookup by path, does-target-exist, backlinks-for, all-tags, all-types).
- First consumer — broken-link styling: links whose target does not exist in the index render visually distinct (e.g. dashed/red). This NEVER blocks editing or navigation; broken links are tolerated per the OKF spec.

Type: **AFK**.

## Acceptance criteria

- [ ] Index is built on startup and reflects all Concepts' frontmatter and outbound links
- [ ] Editing/creating/deleting a Concept updates the index without a full restart
- [ ] A reverse (backlink) map is queryable
- [ ] Links to missing targets render visually distinct but remain clickable and non-blocking
- [ ] Query commands return frontmatter, link existence, backlinks, tags, and types

## Blocked by

- frontmatter-properties-panel.md
- markdown-links-navigation.md
