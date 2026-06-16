## What to build

When a new Concept is created from the tree, scaffold it spec-valid with a frontmatter stub and offer `type` autocomplete from the index.

- A newly created `.md` opens with a frontmatter stub: a `type` field (cursor placed there) and a `title` derived from the filename.
- The `type` field autocompletes against the set of existing `type` values in the Bundle (from the index), encouraging consistency while still allowing free entry.

Type: **AFK**.

## Acceptance criteria

- [ ] New Concepts open with `type`/`title` frontmatter, cursor in `type`
- [ ] `title` is derived from the filename
- [ ] Typing in `type` suggests existing Bundle types, and a new type can still be entered freely
- [ ] The created file is immediately valid OKF (has a `type` field once filled)

## Blocked by

- tree-crud.md
- bundle-index-broken-links.md
