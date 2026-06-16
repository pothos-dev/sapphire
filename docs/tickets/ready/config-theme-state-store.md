## What to build

A global config/state store in the OS app-data directory (`~/.config/emerald/` or platform equivalent), default OS-driven theming, and persisted UI state. Nothing is ever written into the Bundle.

- Establish the global config folder. It holds app config and per-Bundle session state, keyed by the Bundle's absolute path.
- Default theme: light/dark following the OS setting. Structure the theming so custom themes/font configs can be added later by reading from this folder, but ship only the OS-driven default now.
- Persist and restore: window size/position; per-Bundle last-open Concept and expanded tree folders.
- Provide a small read/write seam other slices can use to persist their own per-Bundle state (e.g. recent files).

Type: **AFK**.

## Acceptance criteria

- [ ] A global config folder is created in the OS app-data location; the Bundle directory is never written to
- [ ] The app follows the OS light/dark setting by default
- [ ] Relaunching a Bundle restores window size, last-open Concept, and expanded folders
- [ ] A reusable seam exists for persisting per-Bundle state keyed by Bundle path

## Blocked by

- walking-skeleton.md
