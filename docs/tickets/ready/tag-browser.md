## What to build

A tag browser that lists and filters Concepts by their frontmatter `tags`, using the index.

- Aggregate all `tags` values across the Bundle with counts.
- Selecting a tag shows the Concepts carrying it; selecting a Concept opens it.
- Updates as tags change on disk.

Type: **AFK**.

## Acceptance criteria

- [ ] All tags across the Bundle are listed with per-tag counts
- [ ] Selecting a tag filters to the Concepts that carry it
- [ ] Selecting a Concept from the filtered list opens it
- [ ] The tag list reflects edits to frontmatter tags without a restart

## Blocked by

- bundle-index-broken-links.md
