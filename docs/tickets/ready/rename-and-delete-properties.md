## What to build

Make frontmatter keys editable and properties deletable in the Properties panel.

Each property's key becomes an inline text input bound to a local draft, not the live key. The rename commits only on blur or Enter. If the new name is empty or duplicates an existing key, revert to the old name (no-op). Rows are keyed by a stable id (not the key text) so editing a key character-by-character does not re-key the row and steal focus.

Each row gets a delete control (appears on hover) that removes the property.

Block boundaries are handled by the serializer: a document with no properties produces no `---…---` block (just the body); adding the first property synthesizes the block; deleting the last property drops it. The `---` fences are never shown or directly editable.

There is no key protection — every key, including `type`, can be renamed or deleted. The existing `type`-required flag still warns when `type` is missing or has been renamed away.

All mutations go through `setFrontmatter` effects (single source of truth), consistent with the split-frontmatter ticket.

## Acceptance criteria

- [ ] A key can be edited in place; the rename applies on blur or Enter, not per keystroke, and focus is retained while typing.
- [ ] Renaming to an empty string or to a name that already exists reverts to the previous key with no change written.
- [ ] Each property has a delete control that removes it and persists the result.
- [ ] Deleting the last property removes the entire `---…---` block, leaving a clean body.
- [ ] `type` can be renamed/deleted like any other key; the `required` flag still appears when `type` is absent.
- [ ] Complex/unknown properties can be deleted (and their key renamed) without corrupting their preserved value.

## Blocked by

- docs/tickets/ready/split-frontmatter-out-of-editor.md
