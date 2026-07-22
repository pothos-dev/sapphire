## What to build

Extract Sunstone's Rust domain logic into a reusable **`sunstone-core`** workspace
crate, so both the Tauri desktop shell and the future web server can depend on it.
This is a pure refactor — no behavior change, no new features.

- Introduce a Cargo workspace. Move the logic modules (bundle, index + submodules,
  rewrite + submodules, search, paths, config, watcher, slug, wikilink,
  frontmatter/links/outline helpers) into `sunstone-core`, leaving only the
  Tauri-specific shell in `src-tauri` (the `#[tauri::command]` wrappers, window
  geometry, CLI parsing, detached launch, `run()`).
- `src-tauri` depends on `sunstone-core`; the command wrappers stay thin and call
  into the crate exactly as they do today.
- Keep the watcher's emit mechanism abstracted so a non-Tauri host (the web server)
  can drain change events without depending on `tauri::Emitter`. The self-write
  tracker stays in core but is only exercised by the desktop write path.
- All existing Rust unit tests move with their modules and keep passing.

Type: **AFK**.

## Acceptance criteria

- [ ] A Cargo workspace exists with `sunstone-core` and `src-tauri` as members
- [ ] All domain logic lives in `sunstone-core`; `src-tauri` holds only Tauri shell + command wrappers
- [ ] `cd src-tauri && cargo test` and `cargo check` are green (desktop unchanged)
- [ ] `cargo test` for `sunstone-core` is green (tests moved with their modules)
- [ ] The Tauri app still launches and behaves identically (no user-visible change)
- [ ] The watcher exposes a host-agnostic way to receive change events (not bound to `tauri::Emitter`)

## Blocked by

None - can start immediately
