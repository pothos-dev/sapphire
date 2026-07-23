---
type: Concept
title: Focus model — Regions and the Focused item
description: How keyboard focus works in Sunstone — the six-Region grid, directional movement, and the item focused within a Region.
tags: [focus, keyboard, region, navigation]
timestamp: 2026-07-22
---

# Focus model

Sunstone has two nested layers of keyboard focus: the **active Region** (which
surface owns the keyboard) and the **Focused item** (which element inside that
surface the keys act on). Both are defined in the [glossary](/GLOSSARY.md); this
page is the mechanics.

## Regions and the 3×2 grid

A **Region** is an interactive surface that can hold keyboard focus and defines
its own keyboard semantics. Regions are orthogonal to Pane/Section: a Region may
*be* a Pane (the **Editor** — see [editor layout](/editor/editor-layout.md)), live *as* a
Section (**Explorer**, **Tags**, **Outline**, **Backlinks**), or be neither
(**Properties**, which is chrome inside the Editor pane).

The six Regions form a **fixed 3×2 grid**:

|        | col 0 (left) | col 1 (editor) | col 2 (right) |
| ------ | ------------ | -------------- | ------------- |
| row 0  | Explorer     | Properties     | Outline       |
| row 1  | Tags         | Editor         | Backlinks     |

Exactly one Region is active at a time. **DOM focus is the single source of
truth**: the active Region is a rune that *mirrors* `document.activeElement` via
`focusin`/`focusout`; it never drives focus, only reflects it, so the UI can
reactively style the active Region.

## Directional movement

`Alt`+arrows / `Alt`+`hjkl` move the active Region across the grid. Movement:

- **skips absent Regions** and **clamps at grid edges** (no wrap);
- **sticky per-column landing** — moving left/right returns to the Region you
  were last in for the destination column.

Two predicates split "can I go here?":

- **`isPresent()`** — is there content to focus? False for genuinely empty
  Regions (Properties with no open Concept, Tags with no tags). These are
  skipped and never revealed.
- **`isVisible()`** — is the Region shown right now? A Region hidden only by a
  collapse is *present but not visible*; moving into it **reveals** it (flips the
  transient flag) and then focuses it once rendered.

## The Focused item

Within a Region, the **Focused item** is the single navigable element holding
focus — the roving-`tabindex` element. Arrow keys move it; Enter activates it.

The sharp edge is in the **Explorer**: the Focused item (a tree row, the
keyboard cursor) is **distinct from the open Concept**. Arrowing moves the
Focused item without opening anything; Enter opens the Focused Concept into the
Editor. The open Concept keeps its own marker; the Focused item shows a separate
focus ring. They coincide only until you arrow away.

### Focus depths in Properties

The **Properties** Region is a spreadsheet-style 2-column grid (key | value)
where the Focused item is a *cell*, and the cell has **three modes** (see
[ADR 0003](/adr/0003-structured-frontmatter-reserialization.md) for why
frontmatter is edited here rather than in the document):

- **NAV** — the cell wrapper holds focus (spotlight ring); arrows navigate, the
  inner input is not focused.
- **CHIPS** — sub-navigation for a list value: focus rides a roving index across
  the strip `[chip]…[+ new-tag input]` (←/→ move, `d` deletes the focused chip).
- **EDIT** — the cell's input is focused for ordinary text editing.

## Relationships

- Each **Region** has at most one **Focused item**.
- The **Editor** Region *is* a Pane and hosts its own inner structure — see
  [editor layout](/editor/editor-layout.md).
- Terms are indexed in the [glossary](/GLOSSARY.md).
