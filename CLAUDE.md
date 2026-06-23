# Sapphire — agent guide

Sapphire is a CLI-launched **Tauri 2 + SvelteKit (Svelte 5 runes) + Rust**
markdown editor with first-class Open Knowledge Format (OKF) support. Start here,
then read the deeper docs:

- **`ARCHITECTURE.md`** — the implementation contract: stack, repository layout,
  the IPC seam, Rust/editor/state conventions. Read it before touching code.
- **`CONTEXT.md`** — domain language (Bundle, Concept, Wikilink, Region, …). Use
  these terms; avoid the listed synonyms.
- **`docs/adr/`** — architecture decisions. `docs/tickets/` — slice workflow.

## Verifying changes

Every change must keep these green:

| Command | Scope |
|---------|-------|
| `bun test src/lib` | Frontend unit tests over the pure `src/lib/**/*.test.ts` modules |
| `bun run check` | Frontend typecheck (`svelte-check`) |
| `cd src-tauri && cargo test` | Rust unit tests (`#[cfg(test)]` in each module) |
| `cd src-tauri && cargo check` | Rust typecheck |

Playwright specs in `tests/` drive the UI over `vite dev` + the fake backend and
are the primary behavioural test for components, but they need a browser and are
**not runnable in every sandbox**. When you can't run them, restrict component
edits to mechanical pure-logic extraction (verified by `bun run check`) and lean
on the unit + Rust suites.

## Conventions that bite

- **IPC seam**: the frontend never imports `@tauri-apps/api` outside
  `src/lib/ipc/`. All backend access goes through the `Backend` interface; both
  `tauri.ts` (real) and `fake.ts` (in-memory) must implement every method.
- **Pure logic lives in plain `.ts`** (e.g. `path.ts`, `treeNav.ts`,
  `frontmatter.ts`, `outline.ts`, `highlight.ts`) so it can be unit-tested;
  `.svelte`/`.svelte.ts` files stay thin over those helpers.
- **Paths crossing the seam** are bundle-relative, forward-slash.
- Commit messages end with: `🤖 Generated with claude-code`.
