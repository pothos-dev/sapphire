---
type: Reference
title: Sunstone Glossary
description: The canonical domain language for Sunstone — the terms to use and the synonyms to avoid.
tags: [glossary, domain, ubiquitous-language]
timestamp: 2026-07-22
---

# Glossary

Sunstone is a lightweight, CLI-launched Tauri + Svelte markdown editor/viewer with
Obsidian-style live editing and first-class support for the Open Knowledge Format
(OKF). `sunstone ./docs` opens a folder as an editable knowledge base.

## Language

**Bundle**:
The root folder opened by Sunstone — a directory tree of markdown files, per the OKF spec.
_Avoid_: vault, workspace, project (these are other tools' terms).

**Concept**:
A single `.md` file in the Bundle. Carries YAML frontmatter (required `type` field) and a
free-form markdown body.
_Avoid_: note, document, page (use **Concept** as the canonical term; "document" acceptable casually).

**Wikilink**:
An optional, secondary link format written `[[name]]` (Obsidian-style), supported in addition
to — never replacing — standard markdown links, which remain the primary/canonical format.
`name` is matched by **filename** (without `.md`), case-insensitive, bundle-wide; it never
matches the frontmatter `title`. Duplicate filenames resolve to the shortest bundle path, then
alphabetically (silent — ambiguity is not flagged broken), matching Obsidian. Partial paths
(`[[folder/name]]`) match by path **suffix**. Wikilinks are a Sunstone compatibility affordance
for content authored in Obsidian; OKF itself does not use them.
_Avoid_: "internal link" (ambiguous — could mean any in-Bundle link; say **Wikilink** or
**markdown link** specifically).

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

**Diagram**:
The rendered output of a ` ```mermaid ` fenced code block. In source it is an ordinary fenced
code block (so it is excluded from the **Outline**, like all fenced code); under **Live preview**
it renders as a diagram on inactive lines and reveals its raw source when the cursor enters it.
_Avoid_: "chart", "graph" (use **Diagram**; reserve "graph" for the link/backlink sense).

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
The central Pane. It hosts a grid of **Tiles** arranged in **Columns** — a
horizontal row of Columns, each a vertical stack of Tiles. (Before tiling it
showed a single open Concept; that is now the one-Tile case.)

**Column**:
A vertical stack of **Tiles** inside the Editor pane; the Editor pane is a row of
Columns. Columns (and the Tiles within them) are independently resizable via
draggable dividers, and rows need not align across Columns.
_Avoid_: "split" for the noun (a Column is the unit; "Split Right/Down" name the
actions that create one).

**Tile**:
One editor cell within the Editor pane, showing a single open **Concept** with its
own view-mode, scroll position and navigation history. The same Concept may be
open in multiple Tiles at once, sharing one underlying buffer (edits/autosave in
one are reflected in the others). Exactly one Tile is the **active Tile** (the
focused editor cell); the **Outline**, **Backlinks** and **Properties** describe
it.
_Avoid_: "tab" (Tiles are always visible, never behind a tab bar), "split" (a
Tile is the cell; Split is the action), "editor group" (VSCode's tabbed term).

**Accordion**:
The height-sharing behaviour of a Sidebar's stacked Sections (they share the viewport, each
body capped). Names the behaviour, not a single item — one item is a **Section**.

**Region**:
An interactive surface that can hold keyboard focus and defines its own keyboard semantics.
Orthogonal to Pane/Section: a Region may *be* a Pane (the **Editor**), live *as* a Section
(**Explorer**, **Tags**, **Outline**, **Backlinks**), or be neither (**Properties**, which is
chrome inside the Editor pane). Exactly one Region is focused at a time, mirrored from
`document.activeElement`.
_Avoid_: "pane focus", "panel focus" (use "the active Region").

**Focused item**:
The single navigable item that currently holds focus *within* a Region (the roving-tabindex
element) — arrow keys move it, Enter activates it. In the **Explorer** the Focused item is a
tree row and is **distinct from the open Concept**: arrowing moves the Focused item without
opening anything; Enter opens the Focused Concept into the Editor. The open Concept keeps its
own marker; the Focused item shows a separate focus ring.
_Avoid_: "cursor" (reserved for the CodeMirror text caret), "selection" (ambiguous).

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
- A **Concept** links to other **Concepts** primarily via standard markdown links: bundle-absolute
  (`[x](/path.md)`) or relative (`[x](./path.md)`), and optionally via **Wikilinks** (`[[name]]`,
  resolved by filename). Links are tolerated even when broken.
- A **Sidebar** contains many **Sections**; each Section shows a view onto the Bundle or the
  open Concept. The **Accordion** is how a Sidebar's Sections share height.
- A **Region** is any focusable interactive surface; exactly one is the active Region at a time.
  Regions cut across Panes and Sections (see term). Each Region has at most one **Focused item**.
- In the **Explorer**, the **Focused item** (keyboard position) is independent of the open
  **Concept** (what the Editor shows); they coincide only until you arrow away.

## Example dialogue

> **Dev:** "When I arrow down in the **Explorer**, does the **Editor** follow along?"
> **Domain expert:** "No — arrowing only moves the **Focused item**. The open **Concept**
> doesn't change until you press Enter on a tree row."
> **Dev:** "And if the same Concept is open in two **Tiles**?"
> **Domain expert:** "They share one buffer — edit in one Tile and the other reflects it.
> But only one is the active **Tile**, and that's the one the **Outline** and **Backlinks**
> describe."

## Flagged ambiguities

- "docs folder" / "vault" / "workspace" all referred to the opened root — resolved to **Bundle**.
- "side panel" / "panel" / "pane" / "accordion section" were used loosely for the collapsible
  sidebar items — resolved to **Section**, inside a **Sidebar**, with **Accordion** naming only
  the height-sharing behaviour. "Panel" is avoided (VSCode bottom-dock collision).
- "search" referred to both the cross-Bundle full-text modal and the in-editor operation —
  resolved to **Search** (cross-Bundle only) vs **Find** (single-Concept only).
- "pane" was used loosely for "the thing keyboard focus moves between" — but focus targets
  (Editor, Explorer, Properties, ...) don't map to Panes (Properties is neither Pane nor
  Section). Resolved: the focus unit is a **Region**, orthogonal to Pane/Section.
