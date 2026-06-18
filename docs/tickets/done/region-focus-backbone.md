## What to build

The keyboard-focus backbone for the whole app: a notion of the **active Region** and
directional movement between Regions. See `CONTEXT.md` for **Region** and **Focused item**.

The six Regions form a 3×2 grid:

```
   LEFT SIDEBAR        EDITOR PANE         RIGHT SIDEBAR
 [ Explorer ]        [ Properties ]      [ Outline   ]   ← top row
 [ Tags     ]        [ Editor     ]      [ Backlinks ]   ← bottom row
```

Behavior:

- **DOM focus is the source of truth.** A reactive `focusedRegion` rune *mirrors*
  `document.activeElement` via `focusin`/`focusout` listeners — it never drives focus. A new
  `state/focus.svelte.ts` owns this rune plus the per-Region registry and the grid geometry.
- Each Region exposes a focusable entry point (its remembered item, else its first focusable
  element / container). The Editor's entry is the existing CodeMirror view. Regions register
  themselves so the grid knows which cells are present.
- **`Alt+←↓↑→` and `Alt+hjkl` move focus directionally**: left/right change column, up/down
  move within a column. **Sticky per-column landing** — a column remembers which Region you
  were last in and returns you there. Movement **clamps** at the grid edges (no wrap).
- **Sticky per-Region memory**: each Region remembers its last Focused item, so moving away and
  back returns focus to the same item.
- In this slice, **all hidden Regions are skipped** — a Region that is collapsed, absent
  (Properties with no open Concept), or empty (Tags with no tags) is passed over. Transient
  auto-reveal of collapsed Regions is a separate slice (transient-region-auto-reveal.md).
- **`Escape` returns focus to the Editor** (home base) from any non-Editor Region. The full
  peel ordering and overlay opener-restore is a separate slice (escape-peel-restore-opener.md).
- **Active-Region affordance**: the active Region's container gets a *subtle* lighter
  background (driven by `focusedRegion`). No ring/border around the Region — the Focused item's
  existing `:focus-visible` ring stays the prominent spotlight.
- **History rebind**: navigation back/forward moves off `Alt+←/→` (now Region movement) onto
  `Ctrl+Alt+←/→` (Obsidian-style). Update the existing global handler in `App.svelte`.
- The global key handler stays **capture-phase** and must **never** swallow `Ctrl+C`/`Ctrl+V`.

This slice may land focus on a Region's entry point without rich intra-Region arrow navigation
(those are per-Region slices) — but moving between all visible Regions, seeing the active-Region
highlight, and `Escape`-to-Editor must all work end-to-end.

## Acceptance criteria

- [ ] `Alt`+arrows and `Alt`+`hjkl` move focus between all visible Regions per the 3×2 grid
- [ ] Column landing is sticky (returns to the last Region used in that column)
- [ ] Each Region restores its last Focused item when re-entered
- [ ] Hidden/absent/empty Regions are skipped; movement clamps at grid edges
- [ ] The active Region shows a subtle lighter background; the Focused item keeps the spotlight ring
- [ ] `Escape` from a non-Editor Region returns focus to the Editor
- [ ] History back/forward works on `Ctrl+Alt+←/→`; plain `Alt+←/→` no longer navigates history
- [ ] `Ctrl+C`/`Ctrl+V` are never intercepted by the global handler
- [ ] `bun run check`, `bun test src/lib`, and `cargo check` are green
- [ ] A Playwright test drives `Alt`-movement across Regions, asserts the active-Region highlight and focus location, asserts `Escape`→Editor, and saves a screenshot

## Blocked by

- None - can start immediately
