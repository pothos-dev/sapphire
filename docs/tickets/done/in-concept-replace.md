## What to build

In-Concept **Replace**: the replace half of the Find & Replace panel from `in-concept-find.md`.

The CM search panel's replace and replace-all actions edit the open Concept's body. Replacements must flow through the **existing autosave** path and be covered by **CM undo/redo** — no new persistence mechanism is introduced. The case / whole-word / regex toggles apply to replace as well (e.g. regex capture-group replacement within a single Concept).

This slice verifies the mutation path end-to-end; the panel chrome itself ships in the blocking ticket.

Type: **AFK**.

## Acceptance criteria

- [ ] Replace (single) replaces the current match and advances; Replace-all replaces every match in the open Concept.
- [ ] Replacements persist via the existing autosave (no separate save path).
- [ ] A replace (including replace-all) is undoable/redoable as expected through CM history.
- [ ] Regex mode supports capture-group replacement; case / whole-word toggles affect replace consistently with find.
- [ ] Replace operates on the body only; frontmatter is untouched (ADR 0003).

## Blocked by

- docs/tickets/ready/in-concept-find.md
