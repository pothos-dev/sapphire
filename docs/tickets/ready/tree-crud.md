## What to build

Create, rename, delete, and move Concepts and folders from the document tree.

- Right-click context menu (and/or toolbar) on tree nodes: new Concept, new folder, rename, delete, move.
- Rust commands perform the filesystem operations.
- Move/rename at this stage is a plain filesystem operation — link rewriting is handled in a separate slice (link-auto-rewrite.md). Inbound links may break for now; that is tolerated.
- The tree and index reflect the change (via the watcher / index update).

Type: **AFK**.

## Acceptance criteria

- [ ] Create, rename, delete, and move work for both Concepts and folders from the tree
- [ ] Operations are reflected in the tree without a restart
- [ ] Delete asks for confirmation (or is undoable) to avoid accidental data loss
- [ ] Moving a file does not yet rewrite links (deferred), and does not crash on broken results

## Blocked by

- editing-autosave-watcher.md
