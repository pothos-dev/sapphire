## What to build

Rename the application from "emerald" to "Sapphire" across every identity surface so the built app, window, and package metadata all present as Sapphire. This is a textual/identity slice only — no behavior changes.

Surfaces to update:

- **npm package** — `name` in `package.json` → `sapphire`.
- **Rust crate** — `name` and the `emerald_lib` library name in `src-tauri/Cargo.toml`. Renaming the lib crate cascades to its imports in the Rust entrypoints (`build.rs`, `lib.rs`/`main.rs`) and `Cargo.lock`; update them so the backend still builds.
- **Tauri config** (`src-tauri/tauri.conf.json`) — `productName` → `Sapphire`, window `title` → `Sapphire`, and `identifier` → `md.sapphire.app`.
- **Stale references** — the `Emerald`/`emerald` mentions in code comments and prose (e.g. `src/lib/App.svelte`, `CONTEXT.md`, `ARCHITECTURE.md`, `docs/okf-spec.md`) updated to Sapphire where they refer to the product name. Leave unrelated occurrences (the gemstone in example/reference fixtures) alone.

Do NOT rename the existing `docs/tickets/done/*emerald*` ticket files or historical commit references — those are history.

## Acceptance criteria

- [ ] `bun tauri dev` (or build) launches with the window title "Sapphire"
- [ ] The Rust backend compiles after the crate/lib rename (no dangling `emerald_lib` imports)
- [ ] `package.json` name is `sapphire`; Tauri `productName` is `Sapphire`; identifier is `md.sapphire.app`
- [ ] No remaining product-name references to "emerald"/"Emerald" in source, config, or current docs (verified by grep, excluding example/reference fixtures and done-ticket history)
- [ ] Existing tests still pass

## Blocked by

- None - can start immediately
