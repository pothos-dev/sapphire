## What to build

Let users add new frontmatter properties from the Properties panel. Two add affordances — `[+ Text]` and `[+ List]` — create a new scalar property or a new flat-list (chip) property respectively. The value kind is chosen at creation and fixed thereafter (to change kind, delete and re-add).

A freshly added row opens with its key input focused and empty. Blurring with an empty key discards the row (there is no prior key to revert to). Committing a valid, non-duplicate key keeps the row; an empty value is allowed.

New properties are appended after existing ones. Adding the first property to a document with no frontmatter synthesizes the `---…---` block (per the serializer).

All mutations go through `setFrontmatter` effects.

## Acceptance criteria

- [ ] `[+ Text]` adds an empty scalar property with a focused, empty key input; `[+ List]` adds an empty chip-list property the same way.
- [ ] Committing a valid key persists the new property; the created kind (text vs list) is fixed.
- [ ] Blurring a new row with an empty key discards the row without writing anything.
- [ ] A duplicate key on a new row is rejected (row not committed under the duplicate name), consistent with rename behavior.
- [ ] Adding the first property to a frontmatter-less document creates the block and writes valid markdown.

## Blocked by

- docs/tickets/ready/rename-and-delete-properties.md
