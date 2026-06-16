## What to build

Special tree treatment for OKF reserved files (`index.md`, `log.md`). They are edited as normal markdown — no special rendered views — but are surfaced differently in the tree.

- Reserved files are stripped from the normal tree listing (not shown as ordinary leaf nodes).
- Each folder row that contains an `index.md` and/or `log.md` shows small icons that jump straight to those files when clicked.
- Right-clicking a folder offers "Create index.md" / "Create log.md" when they are missing.
- Reserved files are exempt from the required-`type` frontmatter check (frontmatter is allowed but not required on them; e.g. `tags` on an `index.md` is handled normally).
- `index.md` can appear at any directory level; this applies per-folder.

Type: **AFK**.

## Acceptance criteria

- [ ] `index.md`/`log.md` do not appear as ordinary tree leaves
- [ ] A folder containing them shows icons that open them directly
- [ ] Right-click on a folder offers to create whichever reserved file is missing
- [ ] Reserved files open and edit as normal markdown and are not flagged for missing `type`
- [ ] Behavior applies at every directory level, not just the Bundle root

## Blocked by

- frontmatter-properties-panel.md
- tree-crud.md
