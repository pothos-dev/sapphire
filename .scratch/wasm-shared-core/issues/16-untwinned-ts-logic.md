# 16 — Un-twinned pure TS: write-in-Rust vs keep-TS

Type: grilling
Status: open
Blocked by: 09, 10

## Question

Several pure-TS modules have **no Rust twin**, so they can't be *deleted* by migration —
only rewritten in Rust (new work) or consciously left in TS. Full-migration scope
forces a per-module call:

- `diff/diffToCriticMarkup.ts` (LCS line diff → CriticMarkup) — substantial; review
  feature. Port to Rust for consistency, or keep TS?
- `fuzzy.ts` (command-palette scoring), `highlight.ts` (match highlighting) — small,
  frontend-only UX. Keep TS?
- `reserved.ts` (+ `reservedStub`), `frontmatter.ts` `scaffoldConcept`/`titleFromFilename`
  — scaffolding the Rust backend deliberately left as a "later slice" (`bundle.rs:142`).
  Migrate the scaffold logic to Rust to unify, or keep TS?
- `editor/textFormat.ts`, `editor/mermaidBlocks.ts`/`mermaidTheme.ts` — editor-only.

Default recommendation to weigh: keep frontend-only UX logic in TS (no drift partner,
no benefit), port only what shares a contract with the backend. Record the rationale
per module — this defines the true end-state of "full migration".

## Sharpened criterion from [10](10-migrate-link-family.md)

The keep-vs-port call is now **two-pronged**, not just "shares a backend contract":
migrate into wasm if **(a)** it's a *twin* of Rust logic, **or** **(b)** it's
frontend-only but *operates over state resident in the wasm handle*. Counterweight:
(b) never justifies creating a *new* twin.

Per-module consequence to decide here:

- **`fuzzy.ts`** — 10 already concluded (pending this ticket's confirmation): **stays TS**.
  It's a (b) candidate (ranks the concept-path set) *but* also ranks tags, which are **not**
  in the wasm handle (Rust-backend index over IPC). Moving it inward would force tags to
  cross in and spawn a concept-vs-tag fuzzy twin — a (b)-to-(a) violation. Instead the
  handle exposes **`conceptPaths()`** (landed in 10) and `fuzzy.ts` is *fed* that set;
  the `backend.listConceptPaths()` IPC fetch + `suggestions.conceptPaths` copy are retired.
  **This ticket owns the `QuickNav`/`suggestions.svelte.ts` rewire** onto `conceptPaths()`.
- **`highlight.ts`**, **`editor/textFormat.ts`**, **`editor/mermaidBlocks.ts`/`mermaidTheme.ts`**
  — neither (a) nor (b) (no twin, touch no wasm state) → keep TS.
- **`diff/diffToCriticMarkup.ts`**, **`reserved.ts`**, `frontmatter.ts` scaffold fns —
  still judged on (a) alone (contract-sharing / consistency); (b) doesn't apply.
