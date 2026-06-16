## What to build

Make the editor writable with Obsidian-like autosave, and reflect external file changes live.

- The CM6 editor becomes editable.
- A Rust command writes a Concept back to disk.
- Edits autosave on a short debounce (~300ms after typing stops) and on blur. There is no save button.
- A filesystem watcher (notify crate) emits events when files in the Bundle change on disk, so the tree updates on add/remove/rename and the open Concept reloads when changed by another tool.
- Critically, Emerald's own autosave writes must NOT trigger a reload loop or yank the cursor: the backend suppresses watcher events for paths Emerald just wrote (track recent self-writes and ignore the echo). Genuine external edits still reload.

Type: **AFK**.

## Acceptance criteria

- [ ] Typing in the editor persists to disk within ~300ms of stopping, with no save button
- [ ] Editing a file in an external editor updates the tree and reloads the open Concept
- [ ] Autosave does not cause the open Concept to reload or the cursor to jump
- [ ] Creating/deleting a file on disk (externally) updates the tree

## Blocked by

- walking-skeleton.md
