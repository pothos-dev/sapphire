---
type: Concept
title: Nav bar — the global controls header
description: The app header spanning the top of the Editor pane, holding only the controls that are global to the whole app — Sidebar toggles, the view-mode segmented control, and the Properties toggle.
tags: [interface, navbar, header, toolbar, chrome]
timestamp: 2026-07-23
---

# Nav bar

The **nav bar** is the app header — a thin toolbar (`NavBar.svelte`, aria-label "Global controls") spanning the top of the [Editor pane](/editor/editor-layout.md) in the [app shell](/interface/app-shell.md). Its defining rule: **it holds only controls that are global to the whole app**, never controls scoped to one Tile or Concept. Per-Tile controls (undo/redo, review, export, close, split, history) live in the **TileHeader** above each Tile instead.

## Controls

The bar has two tracks — one Sidebar toggle at the start, the rest at the end:

| Control | Position | Backs |
| ------- | -------- | ----- |
| Left Sidebar toggle | left | `leftSidebarOpen` — collapse/expand the [left Sidebar](/interface/sidebars.md) |
| View-mode segmented control | right | `editorMode` — the global tri-state **Source / Live / Reading** |
| Properties toggle | right | `propertiesShown` — inline frontmatter chrome in every Tile |
| Right Sidebar toggle | right | `rightSidebarOpen` — collapse/expand the [right Sidebar](/interface/sidebars.md) (Outline & Backlinks) |

The **view-mode** control is a connected segmented control of three icons (hashtag = Source, pen = Live, book = Reading); switching mode applies to **every visible Tile at once**, and the whole group is disabled when no Concept is open. The **Properties** toggle is a single global flag — on, every visible Tile renders its own Concept's frontmatter inline; off, no Tile shows any Properties chrome.

Each of these four flags is [View state](/interface/view-state.md): the choice is persisted per-user and restored on relaunch.

## Not here (yet)

**Search** and **Quick-nav** are keyboard-driven today (`Ctrl+Shift+F` / `Ctrl+K`) and theme follows the OS, so those global affordances have no button on the bar yet — the nav bar is the seam they land on if they grow one.

## Relationships

- The nav bar is the header of the [app shell](/interface/app-shell.md), above the [Editor pane](/editor/editor-layout.md).
- Its toggles drive the [Sidebars](/interface/sidebars.md) and the Properties chrome; every toggle's value is [View state](/interface/view-state.md).
- Terms are indexed in the [glossary](/GLOSSARY.md).
