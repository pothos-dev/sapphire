# Emerald

A lightweight, CLI-launched Tauri + Svelte markdown editor/viewer with Obsidian-style
live editing and first-class support for the Open Knowledge Format (OKF). `emerald ./docs`
opens a folder as an editable knowledge base.

## Language

**Bundle**:
The root folder opened by Emerald — a directory tree of markdown files, per the OKF spec.
_Avoid_: vault, workspace, project (these are other tools' terms).

**Concept**:
A single `.md` file in the Bundle. Carries YAML frontmatter (required `type` field) and a
free-form markdown body.
_Avoid_: note, document, page (use **Concept** as the canonical term; "document" acceptable casually).

**Reserved file**:
A file with OKF-defined special meaning: `index.md` (progressive-disclosure listing) and
`log.md` (dated change history). Not ordinary Concepts.

**Frontmatter**:
The leading YAML block (delimited by `---`) on a Concept. Only `type` is required;
`title`, `description`, `resource`, `tags`, `timestamp` are recommended; unknown keys must
be preserved.

**Live preview**:
Obsidian-style hybrid editing — markdown source is the source of truth, but inactive lines
render styled while the cursor line shows raw markup. Implemented via CodeMirror 6 decorations.

## Relationships

- A **Bundle** contains many **Concepts** and **Reserved files**, nested in directories.
- A **Concept** has one **Frontmatter** block and one markdown body.
- A **Concept** links to other **Concepts** via standard markdown links: bundle-absolute
  (`[x](/path.md)`) or relative (`[x](./path.md)`). Links are tolerated even when broken.

## Flagged ambiguities

- "docs folder" / "vault" / "workspace" all referred to the opened root — resolved to **Bundle**.
