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

### UI chrome

These name the layout, not the domain. Register is conventional editor chrome (VSCode-style),
deliberately not domain language — section headers are discoverability affordances.

**Pane**:
Any top-level layout region of the app shell.

**Sidebar**:
A Pane docked to the left or right edge, holding a vertical stack of **Sections**. There may
be a left and a right Sidebar (only the left exists today).
_Avoid_: "side panel" (use Sidebar).

**Section**:
One collapsible item in a Sidebar — an always-visible header plus a toggleable body. The three
current Sections are **Explorer** (the Bundle tree), **Backlinks** (Concepts linking to the
open Concept), and **Tags** (tags across the Bundle).
_Avoid_: "panel" (collides with VSCode's bottom dock).

**Editor pane**:
The central Pane showing the open Concept.

**Accordion**:
The height-sharing behaviour of a Sidebar's stacked Sections (they share the viewport, each
body capped). Names the behaviour, not a single item — one item is a **Section**.

## Relationships

- A **Bundle** contains many **Concepts** and **Reserved files**, nested in directories.
- A **Concept** has one **Frontmatter** block and one markdown body.
- A **Concept** links to other **Concepts** via standard markdown links: bundle-absolute
  (`[x](/path.md)`) or relative (`[x](./path.md)`). Links are tolerated even when broken.
- A **Sidebar** contains many **Sections**; each Section shows a view onto the Bundle or the
  open Concept. The **Accordion** is how a Sidebar's Sections share height.

## Flagged ambiguities

- "docs folder" / "vault" / "workspace" all referred to the opened root — resolved to **Bundle**.
- "side panel" / "panel" / "pane" / "accordion section" were used loosely for the collapsible
  sidebar items — resolved to **Section**, inside a **Sidebar**, with **Accordion** naming only
  the height-sharing behaviour. "Panel" is avoided (VSCode bottom-dock collision).
