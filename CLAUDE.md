# Sunstone — agent guide

Sunstone is a CLI-launched **Tauri 2 + SvelteKit (Svelte 5 runes) + Rust**
markdown editor with first-class Open Knowledge Format (OKF) support. Start here,
then read the deeper docs:

- **`ARCHITECTURE.md`** — the implementation contract: stack, repository layout,
  the IPC seam, Rust/editor/state conventions. Read it before touching code.
- **`docs/GLOSSARY.md`** — domain language (Bundle, Concept, Wikilink, Region, …).
  Use these terms; avoid the listed synonyms.
- **`docs/adr/`** — architecture decisions. `docs/tickets/` — slice workflow.

## Verifying changes

Every change must keep these green:

| Command | Scope |
|---------|-------|
| `bun test src/lib` | Frontend unit tests over the pure `src/lib/**/*.test.ts` modules |
| `bun run check` | Frontend typecheck (`svelte-check`) |
| `cd src-tauri && cargo test` | Rust unit tests (`#[cfg(test)]` in each module) |
| `cd src-tauri && cargo check` | Rust typecheck |

Playwright specs in `tests/` drive the UI over a `vite build` + `vite preview`
static SPA on port 1420 with the fake backend, and are the primary behavioural
test for components.

### Running Playwright

```bash
bunx playwright test                              # normal machine (browsers installed)
bunx playwright test tree-crud region-focus       # a subset (match by spec name)
```

The runner needs a Chromium. On a normal machine, install it once with
`bunx playwright install chromium`. **In a sandbox that lacks the ms-playwright
browser cache** (and where `playwright install` can't download), point the
runner at an already-present system Chromium via the committed override config:

```bash
bunx playwright test -c playwright.local.config.ts                 # uses /tmp/chromium
CHROMIUM_BIN=/path/to/chromium bunx playwright test -c playwright.local.config.ts
```

`playwright.local.config.ts` inherits everything from `playwright.config.ts` and
only swaps in `launchOptions.executablePath` (+ `--no-sandbox`). Check for a
system Chromium with `ps aux | grep -i chromium` or a running CDP endpoint
(`curl -s localhost:9222/json/version`); its binary is the `CHROMIUM_BIN`.

If NO browser is available at all, restrict component edits to mechanical
pure-logic extraction (verified by `bun run check`) and lean on the unit + Rust
suites.

## Conventions that bite

- **IPC seam**: the frontend never imports `@tauri-apps/api` outside
  `src/lib/ipc/`. All backend access goes through the `Backend` interface; both
  `tauri.ts` (real) and `fake.ts` (in-memory) must implement every method.
- **Pure logic lives in plain `.ts`** (e.g. `path.ts`, `treeNav.ts`,
  `frontmatter.ts`, `outline.ts`, `highlight.ts`) so it can be unit-tested;
  `.svelte`/`.svelte.ts` files stay thin over those helpers.
- **Paths crossing the seam** are bundle-relative, forward-slash.
- Commit messages end with: `🤖 Generated with claude-code`.
