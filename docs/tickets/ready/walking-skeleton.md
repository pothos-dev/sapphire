## What to build

The walking skeleton: `emerald [path]` launches a Tauri window that shows the Bundle as a document tree on the left and a read-only view of the focused Concept on the right.

- CLI: `emerald <path>` opens that directory as the Bundle; `emerald` with no argument opens the current working directory. The resolved absolute path is read in the Rust `setup` step and handed to the frontend.
- Rust owns the filesystem: a command to list the Bundle's directory tree, and a command to read a single Concept's raw markdown.
- Svelte frontend: left pane renders the tree (folders expand/collapse); clicking a `.md` file loads it into the right pane.
- Right pane shows the Concept content in a CodeMirror 6 editor in read-only mode (no live preview, no editing yet — that comes in later slices).

Type: **AFK**.

## Acceptance criteria

- [ ] `emerald ./some/dir` opens a window scoped to that directory; `emerald` opens the cwd
- [ ] The left pane shows the directory tree of the Bundle, with working expand/collapse
- [ ] Clicking a markdown file shows its raw content in a read-only CM6 editor on the right
- [ ] Non-markdown files are either hidden or non-openable (tree shows the Bundle, focus is on `.md`)
- [ ] Project builds and runs via the Tauri dev workflow

## Blocked by

None - can start immediately.
