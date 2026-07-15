## What to build

The walking skeleton for **Sapphire Web**: a browser can open the app, see the
Bundle's Explorer tree, click a Concept, and read its raw markdown — served by a
new HTTP server over the same `sapphire-core` logic the desktop app uses. This is
the fat tracer bullet: it stands up the server, the client seam, the web build
target, and SSR all at once, so later slices are thin additions.

- New **`sapphire-server`** axum binary depending on `sapphire-core`. It resolves
  the Bundle root from `SAPPHIRE_BUNDLE` (as the desktop already supports) and
  exposes read-only routes for `bundleRoot`, `listTree`, and `readConcept`. Paths
  crossing the seam stay bundle-relative, forward-slash; the existing Rust
  traversal/escape validation guards them — now as a genuine network boundary.
- New **`http.ts`** implementation of the `Backend` interface (a read-only subset),
  talking to the server via `fetch`. Write methods are absent from the web subset.
- Web build target: the frontend can be built to run against the HTTP backend
  (selected by build-time flag), distinct from the Tauri and fake backends. The
  IPC-seam rule holds — no `@tauri-apps/api` in the web build.
- SvelteKit **adapter-node SSR**: the app shell (Explorer tree via the reused
  `Tree` component, and a read-only pane showing the selected Concept's raw
  markdown) is server-rendered, then hydrates. SSR `load()` talks to the Rust
  server directly; hydrated islands go through the `http.ts` Backend seam.
- No write affordances anywhere in the web UI (no create/rename/delete/edit).

Type: **AFK**.

## Acceptance criteria

- [ ] `sapphire-server` serves `bundleRoot`, `listTree`, and `readConcept` over HTTP against a `SAPPHIRE_BUNDLE` bundle
- [ ] Path-escape attempts (`..` outside the bundle) are rejected over HTTP
- [ ] `http.ts` satisfies the read-only `Backend` subset via `fetch`; no `@tauri-apps/api` in the web build
- [ ] The web build serves an SSR'd shell: Explorer tree renders server-side and hydrates
- [ ] Clicking a tree row shows the Concept's raw markdown in a read-only pane
- [ ] No create/rename/delete/edit UI is present in the web build
- [ ] `bun run check` is green; a Playwright spec drives the web viewer against the fake backend's read-only subset with a screenshot

## Blocked by

- web-extract-sapphire-core.md
