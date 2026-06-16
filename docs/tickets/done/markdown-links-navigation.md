## What to build

OKF markdown links that navigate between Concepts, with browser-style history in the single editor pane.

- A CM6 extension recognizes standard markdown links to other Concepts: bundle-absolute (`[label](/path.md)`) and relative (`[label](./path.md)`).
- Clicking a link resolves the target against the Bundle and opens it in the editor (the single focused pane).
- Back/forward navigation history: Back returns to the previous Concept, Forward re-advances. Bind Alt+← / Alt+→ and show back/forward affordances.

Type: **AFK**.

## Acceptance criteria

- [ ] Absolute (`/...`) and relative (`./...`) links resolve to the correct Concept
- [ ] Clicking a link opens the target in the focused pane
- [ ] Back/forward navigates the visited-Concept history, including via Alt+← / Alt+→
- [ ] Navigating preserves the no-save-button autosave behavior (no data loss when jumping)

## Blocked by

- editing-autosave-watcher.md
