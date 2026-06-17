# Sapphire

A lightweight, CLI-launched Tauri + Svelte markdown editor/viewer with Obsidian-style
live editing and first-class support for the Open Knowledge Format (OKF). `sapphire ./docs`
opens a folder as an editable knowledge base.

## Language

**Bundle**:
The root folder opened by Sapphire — a directory tree of markdown files, per the OKF spec.
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
A Pane docked to the left or right edge, holding a vertical stack of **Sections**. Both a left
and a right Sidebar exist. The left holds **Explorer** and **Tags**; the right holds **Outline**
and **Backlinks** and starts collapsed.
_Avoid_: "side panel" (use Sidebar).

**Section**:
One collapsible item in a Sidebar — an always-visible header plus a toggleable body. The current
Sections are **Explorer** (the Bundle tree), **Tags** (tags across the Bundle), **Outline** (the
open Concept's headings) and **Backlinks** (Concepts linking to the open Concept). The **Tags**
Section is hidden entirely when the Bundle carries no tags.
_Avoid_: "panel" (collides with VSCode's bottom dock).

**Outline**:
The **Section** listing the open Concept's markdown headings in document order, indented by
heading level. Selecting a heading scrolls the Editor pane to it. Derived live from the open
Concept's body (frontmatter and fenced code blocks excluded).

**Editor pane**:
The central Pane showing the open Concept.

**Accordion**:
The height-sharing behaviour of a Sidebar's stacked Sections (they share the viewport, each
body capped). Names the behaviour, not a single item — one item is a **Section**.

**Search**:
Bundle-wide full-text search — the centered modal (`Ctrl+Shift+F`) that scans every Concept
body across the Bundle and lists matching path/line/snippet hits. Always means the cross-Bundle
operation.
_Avoid_: using "search" for the in-editor operation (use **Find**).

**Find** (Find & Replace):
The in-Concept, editor-local find/replace panel (`Ctrl+F`) docked above the Editor pane. Scoped
to the open Concept's body only (frontmatter lives outside the document — see ADR 0003 — and is
edited via the Properties Section, not Find). Always means the single-Concept operation.
_Avoid_: calling this "search" (reserved for the cross-Bundle **Search**).

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
- "search" referred to both the cross-Bundle full-text modal and the in-editor operation —
  resolved to **Search** (cross-Bundle only) vs **Find** (single-Concept only).
