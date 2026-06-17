## What to build

Hide the Properties (frontmatter) panel entirely for OKF reserved files. Per docs/okf-spec.md §3.1 and §6–§7, `index.md` carries no frontmatter (the optional bundle-root `okf_version` case is out of scope here) and `log.md` carries none. For these files the editor shows the body only, with no Properties panel and no Add buttons.

The reserved-file determination should reuse whatever the codebase already uses to recognize reserved files (the existing reserved-file exemption logic referenced by the Properties panel).

## Acceptance criteria

- [ ] Opening `index.md` (any level) shows no Properties panel.
- [ ] Opening `log.md` (any level) shows no Properties panel.
- [ ] Opening a normal concept still shows the Properties panel.
- [ ] No regression to body editing for reserved files.

## Blocked by

- docs/tickets/ready/split-frontmatter-out-of-editor.md
