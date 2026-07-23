---
type: Concept
title: Sidebars and Sections
description: The left and right Sidebars, their collapsible Sections and Accordion height-sharing, and how a collapsed Section is transiently revealed by keyboard focus.
tags: [interface, sidebar, section, accordion, navigation]
timestamp: 2026-07-23
---

# Sidebars and Sections

A **Sidebar** is a [Pane](/GLOSSARY.md) docked to the left or right edge of the [app shell](/interface/app-shell.md), holding a vertical stack of **Sections**. A **Section** is one collapsible item — an always-visible header plus a toggleable body. This is deliberately conventional editor chrome (VSCode-style); the section headers are discoverability affordances, not domain language.

## The two Sidebars

| Sidebar | Sections | Fresh-Bundle default |
| ------- | -------- | -------------------- |
| Left | **Explorer** (the Bundle tree), **Tags** (tags across the Bundle) | expanded; Explorer open, Tags collapsed |
| Right | **Outline** (open Concept's headings), **Backlinks** (Concepts linking here) | collapsed entirely |

The **Tags** Section is hidden *entirely* when the Bundle carries no tags. The **Outline** is derived live from the active Tile's body (frontmatter and fenced code excluded); selecting a heading scrolls the Editor pane to it. **Backlinks** and **Tags** are index-backed read queries; on the web build they are served read-only from the core in-memory index.

## Accordion height-sharing

The **Accordion** names the behaviour of a Sidebar's stacked Sections sharing the viewport: each expanded Section's body is capped so several can be open at once without one starving the rest. It names the *behaviour*, not a single item — one item is always a **Section**.

## Two levels of collapse

Collapse is tracked at two granularities, each with its own persisted flag (see [view state](/interface/view-state.md)):

- **Whole Sidebar** — `leftSidebarOpen`, `rightSidebarOpen`. A collapsed Sidebar hides all its Sections and hands the width to the Editor pane. Toggled from the NavBar.
- **Per Section** — `explorerOpen`, `tagsOpen`, `outlineOpen`, `backlinksOpen`. Toggled by the Section header chevron.

A Section is only actually shown when its Sidebar is expanded *and* its own flag is open.

## Transient reveal

A Section (or a whole Sidebar) hidden only by a *collapse* is **present but not visible** — its content still exists. When directional [focus](/interface/focus-model.md) moves *into* such a Region, the shell flips a matching **ephemeral reveal flag** (`leftSidebarRevealed`, `explorerRevealed`, …) so the collapsible renders open and focus can land inside. On focus truly leaving, the flag clears and the UI snaps back to the persisted `*Open` state.

- Effective visibility is therefore `*Open || *Revealed`.
- Reveal flags are keyed at the **same granularity** as the persisted ones (each Sidebar, each Section), so a reveal opens exactly the level that was hidden.
- Reveal flags are **never persisted** — a Region stays open after a visit only if it was manually opened *before* the visit.

## Relationships

- Both Sidebars are Panes of the [app shell](/interface/app-shell.md), flanking the [Editor pane](/editor/editor-layout.md).
- Each Section is a focusable [Region](/interface/focus-model.md); reveal is how the focus model reaches a collapsed one.
- Collapse flags are persisted per-user via [view state](/interface/view-state.md).
- Terms (Sidebar, Section, Accordion, Outline) are indexed in the [glossary](/GLOSSARY.md).
