# 16 — Un-twinned pure TS: write-in-Rust vs keep-TS

Type: grilling
Status: resolved
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

## Answer

**End-state of "full migration": every un-twinned module stays TS. Nothing ports to
Rust/wasm.** No un-twinned module is a twin (prong a) or operates over wasm-handle state
(prong b), so migrating any of them would *manufacture* a new twin to maintain — the exact
move the counterweight forbids. The one active consequence is a wire change, not a port.

Per module:

| Module | Verdict | Rationale |
|---|---|---|
| `fuzzy.ts` | **keep TS** (confirms 10) | (b) candidate but also ranks **tags** (Rust-backend index over IPC, not in the handle); moving it inward spawns a concept-vs-tag twin. Fed the handle's `conceptPaths()` instead. |
| `highlight.ts`, `editor/textFormat.ts`, `editor/mermaidBlocks.ts` / `mermaidTheme.ts` | **keep TS** | neither prong — no twin, touch no wasm state; frontend-only editor/UX. |
| `reserved.ts` (+ `reservedStub`) | **keep TS** | a `Set` membership test on `basename` (which stays TS per [15](15-migrate-path-helpers.md)); pure frontend tree-filter / affordance / Properties concern. Crossing the wasm boundary for a basename check is absurd — same class as 15's helpers. No maintained Rust twin. |
| `diff/diffToCriticMarkup.ts` | **keep TS** | no Rust twin; diffs two arbitrary IPC-fetched strings (working-tree vs rev), not handle state. Its only backend tie is that output must re-parse with `parseCriticMarks` — a **consumer** relationship (13's shared parser reads it), not a drift twin. "Substantial" ≠ a migration trigger; drift-kill / wasm-state is, and neither applies. |
| `frontmatter.ts` `scaffoldConcept` / `titleFromFilename` | **keep TS** | **No Rust twin exists**: `bundle.rs::create_concept` deliberately writes an *empty* file (the "rich frontmatter scaffold is a later slice"); the frontend supplies content via `treeActions → writeConcept(path, scaffoldConcept(path))`. It's frontmatter **authoring** glue — the same family [11](11-migrate-frontmatter-family.md) Fork C kept TS (property model / serialize). Fails both wasm prongs. *(Future option, out of scope here: unify scaffolding into the native `create_concept` command so desktop/web/fake share one stub — that's a **backend refactor**, orthogonal to the additive-wasm seam and explicitly outside this effort's plan-only, frontend-process scope; the ADR notes it as possible follow-up, not part of this migration.)* |

**Active consequence this ticket owns — the `conceptPaths()` rewire (not a port):**
`suggestions.svelte.ts:36` currently fetches the concept-path set via `backend.listConceptPaths()`
(IPC) into a `$state` copy. The migration retires that: the wasm `BundleIndex` handle exposes
`conceptPaths()` (decided in [10](10-migrate-link-family.md) Fork C), so `suggestions.svelte.ts`
(feeding `QuickNav`) reads the set from the handle and the `listConceptPaths()` IPC method +
the `suggestions.conceptPaths` copy are deleted. `fuzzy.ts` stays TS and is *fed* that set.
Plan-only: this is a spec, executed inside the link-family migration PR ([10](10-migrate-link-family.md)/
[09](09-migration-sequencing.md)'s clean-cut), not a standalone PR.

**No new tickets; no fog graduated; nothing newly out of scope** (the scaffold-to-backend
option is future follow-up, not this effort's scope). Resolving 16 leaves only
[17](17-adr-assembly.md) — the ADR assembly — on the frontier.
