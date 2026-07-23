# 10 — Migrate the link-resolution family (the seed / end-to-end proof)

Type: grilling
Status: resolved
Blocked by: 03, 04, 09

## Question

Define the exact disposition of the link family across the wasm boundary — the first
family, proving the seam end to end.

Covers: `links.ts` (`resolveLink`, `findBundleRoot`, `applyBundleRoot`,
`normalizeSegments`), `slug.ts`, `anchorRewrite.ts`, and the **third** rewrite reimpl
in `ipc/fake/links.ts` (`planRewrites`, `rewriteTarget`, `rewriteWikilinksIn`,
`buildMoveMap`, `shortestResolvingSuffix`) ↔ Rust `paths.rs`, `wikilink.rs`, `slug.rs`,
`index/links.rs`, `rewrite/*.rs`.

Decide: which exact Rust fns get exported; how `broken-links.ts` / `wiki-links.ts`
CodeMirror wrappers call wasm synchronously against the held index (ticket 04); whether
`ipc/fake/links.ts` is deleted entirely (its whole reason — Playwright without Rust —
is subsumed by wasm). List the TS files/functions deleted vs kept-as-thin-wrapper.

## Answer

### Migration criterion (effort-wide principle, surfaced here)

Migrate logic into wasm if **either**: **(a)** it is a *twin* of Rust logic (drift
kill — the original criterion), **or** **(b)** it is frontend-only but *operates over
state resident in the wasm handle* — so that state never has to be marshalled back
out. 04's "`pathList` never crosses" is the special case; generalized: **the handle
owns the set *and* the operations over the set.** Counterweight: (b) does **not**
justify migrating logic that would thereby become a *new* twin — a util that also
serves non-wasm data stays TS and is *fed* the wasm-resident data (see fuzzy, below).
Recorded in the map Notes; sharpens [15](15-migrate-path-helpers.md) and
[16](16-untwinned-ts-logic.md).

### Exported on the `BundleIndex` handle (wasm) — single source

- `resolveLink(currentPath, href) -> ResolvedLink` — from `links.ts::resolveLink`
  (+ `applyBundleRoot`, `normalizeSegments`); `internal` variant carries `exists`
  (03/04). Per-call scalar boundary.
- `resolveWikilink(currentPath, rawTarget) -> {path}|null` — from
  `links.ts::resolveWikilink` (+ `splitWikilinkTarget`); the set stays in-wasm, killing
  the wikilink twin + the per-keystroke `pathList()` crossing (04).
- `bundleRoot() -> string` — from `findBundleRoot`; replaces the `#rootCache` memo in
  `state/index.svelte.ts` (04).
- `exists(path) -> bool` — internal membership check, also callable (04).
- `rewriteAnchorsIn(sourcePath, body, renames) -> { content }` — from `anchorRewrite.ts`
  (`rewriteAnchorsIn` + `maskCode` + `splitSuffix`). **Fork A**: a real *synchronous
  live-buffer* op (`Tile.svelte:handleSaved`, on `view.state.doc.toString()`) — the
  same binding constraint the effort exists for. Establishes the **body-in / body-out**
  boundary. Kills the `pathList()` crossing at `handleSaved`.
- `conceptPaths() -> string[]` — **Fork C**: single source of the membership set,
  retiring the redundant `backend.listConceptPaths()` IPC fetch + the
  `suggestions.conceptPaths` copy. Establishes the **set-list-out** boundary (crossed
  only on user-initiated palette-open — rare, not the hot path).

Three boundary shapes proven by the seed = the template the later families copy:
**per-call scalar** (11's simple fns), **body-in/body-out** (11 frontmatter round-trip,
13 decoration seam), **set-list-out** (b-type consolidations).

### TS deleted in this PR

- **`links.ts`** — whole file → wasm (`resolveLink`, `resolveWikilink`, `findBundleRoot`,
  `applyBundleRoot`, `normalizeSegments`, `splitWikilinkTarget`, `isExternalLink`).
  `isExternalLink` folds in as wasm-internal (its only caller was `anchorRewrite.ts`,
  also migrating); if any standalone TS caller survives, it becomes a one-line helper
  (a scheme regex isn't worth a wasm hop) — not re-exported from a resurrected `links.ts`.
- **`anchorRewrite.ts`** — whole file → wasm.
- Their unit tests (`links.test.ts`, `anchorRewrite.test.ts`) — deleted at cut-over
  after the throwaway parity check (07/09).

### Consumers rewired in this PR

- `Tile.svelte:443` `handleLinkClick` → `indexStore.resolveLink(open, href)` (the
  `{bundleRoot, exists}` options object goes away — both are internal to the handle).
- `Tile.svelte:474-476` `handleSaved` → `indexStore.rewriteAnchorsIn(savedPath, body,
  renames)`; drop `indexStore.pathList()`.
- `Tile.svelte:531-537` broken-link / wiki-link contexts → collapse to direct
  `indexStore.resolveLink` / `resolveWikilink` calls; the `exists`/`bundleRoot`/`allPaths`
  closures are removed.
- `editor/broken-links.ts`, `editor/wiki-links.ts` → call the handle directly.
- `state/index.svelte.ts` → becomes the thin `indexStore` wrapper over the handle
  (owns lifecycle per 04; delegates `bundleRoot()`/`exists()`/`conceptPaths()`).

### Kept / deferred (NOT touched by the seed)

- **`slug.ts`** — its logic crosses to Rust (`slug.rs`, used *internally* by the wasm
  wikilink/anchor code), but the TS file is **kept** because `outline.ts` (still TS)
  imports `slugify`/`slugifyHeadings`. **`slug.ts` is deleted by [13](13-migrate-render-derived-family.md)**
  once outline crosses. Cross-ticket carry-over.
- **`path.ts`** — untouched; its wasm-side use becomes Rust-internal (`paths.rs`), its
  UI-side use (e.g. `QuickNav` `splitPath`) stays TS. Disposition is [15](15-migrate-path-helpers.md).
- **`ipc/fake/links.ts`** (`outboundLinks`, `planRewrites`, `buildMoveMap`,
  `shortestResolvingSuffix`) — **Fork B: deferred to [12](12-migrate-fake-backend-standins.md).**
  It is the fake backend's simulation of the rename/move rewrite that runs as *native
  Rust over IPC* in production; no real frontend caller wants a batch move-rewrite export,
  so the seed doesn't add one. 12 owns replace-vs-port and (per 07) consumes the shared source.
- **`fuzzy.ts`** — stays TS, now *fed* `conceptPaths()` from the handle. It also ranks
  tags (not in wasm), so moving it inward would spawn a concept-vs-tag fuzzy twin —
  a (b)-to-(a) violation. `QuickNav`/`suggestions` rewire + this rationale flagged to
  [16](16-untwinned-ts-logic.md).

### Cut-over (per 09/07)

One PR: land the Rust in `sunstone-shared`, wire the handle methods, rewire the consumers
above, run `links.test.ts`/`anchorRewrite.test.ts`/relevant goldens through wasm once to
confirm byte-identical, then delete the TS impls + tests. All four gates + Playwright green
to merge; rollback = revert.
