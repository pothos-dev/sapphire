---
type: Concept
title: Editor layout — the tiling model
description: How the Editor pane tiles Concepts into a grid of Columns and Tiles, with a single active Tile over a shared buffer.
tags: [editor, tiling, layout, tile, column]
timestamp: 2026-07-22
---

# Editor layout

The **Editor pane** is the central [Pane](/GLOSSARY.md) of the app shell. It is
a **grid of Tiles arranged in Columns**: a horizontal row of Columns, each a
vertical stack of Tiles. Before tiling existed the pane showed a single open
Concept; that is now just the one-Tile case.

## Columns and Tiles

- A **Column** is a vertical stack of **Tiles**; the Editor pane is a row of
  Columns.
- A **Tile** is one editor cell, showing a single open **Concept** with its own
  view-mode, scroll position and navigation history.
- Columns and the Tiles within them are **independently resizable** via
  draggable dividers, and rows need not align across Columns.

`Split Right` / `Split Down` are the actions that create a new Column / Tile;
"split" is never the noun (the Column and Tile are the nouns).

## The active Tile and shared buffers

Exactly one Tile is the **active Tile** — the focused editor cell. The
[Outline, Backlinks and Properties](/GLOSSARY.md) all describe the active Tile.

The same Concept may be open in **multiple Tiles at once**, and they share **one
underlying buffer**: edits and autosave in one Tile are reflected in the others.
This is the Document/Pane split — a *Document* owns a Concept's buffer, dirty
flag, autosave and disk IO (addressable by path via a registry); a view onto it
owns the active Concept, navigation history and view state and attaches to a
Document. Two views onto the same path share one live Document.

## Naming caveat — "Pane" in the code

The workspace layer in the code calls each cell a **`Pane`** ("a row of Columns
of Panes"). That is **not** the glossary's **Pane** (a top-level app-shell
region). In domain language the cell is a **Tile**; the code's `Pane` type is a
legacy internal name from the document-pane-state-split slice. When reading
`workspace.svelte.ts` / `paneLayout.ts`, read their `Pane` as **Tile**.

## Relationships

- The **Editor pane** hosts a row of **Columns**; each Column stacks **Tiles**.
- The Editor pane *is* the **Editor** Region — keyboard focus and Region
  movement are described in the [focus model](/focus-model.md).
- Terms are indexed in the [glossary](/GLOSSARY.md).
