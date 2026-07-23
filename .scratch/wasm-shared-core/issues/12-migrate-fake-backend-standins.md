# 12 — Fake backend: replace stand-ins with wasm, or port them?

Type: grilling
Status: resolved
Blocked by: 03, 04, 09, 10, 11

## Question

The fake backend (`ipc/fake/*`) exists so Playwright's desktop suite runs without a
Rust backend. If the real algorithms are now wasm-in-browser, does the fake backend
**call wasm directly** (deleting its stand-in reimplementations), and where does that
leave the deliberately-divergent stand-ins?

Decide per module:
- **Search** (`fake.ts::search` ↔ `search.rs`) — real Rust uses ripgrep/ignore-walk
  (filesystem); the fake is an in-memory simplified twin. Can wasm serve search over
  an in-memory corpus, or does the fake stay hand-rolled?
- **Whole-doc render** (`ipc/fake/render.ts` ↔ `render.rs` comrak) — the fake is a
  *minimal stand-in*, not a faithful port. [08](08-bundle-size-budget.md) resolved:
  comrak-in-wasm is **deferred out of v1** (~1.5 MB). So the fake renderer likely
  **stays a TS stand-in** for now; revisit replacing it if a later effort accepts the
  render-wasm size. Confirm and record.
- **Tree** (`ipc/fake/tree.ts` ↔ `bundle.rs`) — entangled with in-memory FILES/FOLDERS
  + IO semantics; likely stays TS (weak wasm candidate). Confirm.

## Constraint from [07](07-test-coverage-strategy.md)

07's coverage story makes the desktop Playwright suite the **primary** wasm behavioural
guard, which holds *only if* `fake.ts`'s index/rewrite ops derive from the **same shared
source** (consume wasm) rather than a ported divergent TS re-impl — a divergent fake
silently tests different logic than ships and would force the standing parity harness 07
rejects. So for the **pure** stand-ins with a shared-source twin (rewrite/link/index
family), the default is **consume wasm, delete the TS re-impl**. The deliberately-divergent
IO stand-ins with no pure shared source (search over a filesystem corpus, comrak render
deferred per 08, tree IO) are exempt — they stay hand-rolled TS.

## Answer

**The dividing line is layer, not module.** The fake backend is two layers stacked, and
the cut runs *between* them, not per-file:

- **Layer 1 — pure kernels** (twins of `sunstone-shared` logic): **consume wasm, delete
  the TS re-impl.** These are leaf functions with a shared source, so a ported TS copy is
  exactly the divergent test-twin [07](07-test-coverage-strategy.md) forbids. After
  [10](10-migrate-link-family.md)/[11](11-migrate-frontmatter-family.md)/[13](13-migrate-render-derived-family.md)
  land, the `$lib/*` barrels ARE wasm-backed, so the fake gets this for free by importing
  them — no fake-specific wiring.
- **Layer 2 — backend-command orchestration** over the in-memory corpus (`search`,
  `backlinks`, `allTags`, `conceptsByTag`, `renderConcept` assembly, tree CRUD, git seam):
  **stays hand-rolled TS.** These are NOT twins of any *pure shared* fn — they are twins of
  the *native backend command handlers*, which this effort keeps native by design (map
  Out-of-scope: "the backend index, `backlinks` command … need native Rust"). They may
  freely iterate the corpus and call the Layer-1 wasm kernels; that is the intended shape.

This layer split also settles the modules the ticket named, plus three the ticket text
didn't enumerate:

| Fake surface | Disposition | Why |
|---|---|---|
| `fake/frontmatter.ts` `parseFrontmatter` / `…Fields` / `…Keys` | **→ wasm, delete** | index-parse twins of `index/frontmatter.rs`+`render.rs` (already 11 Fork A) |
| `fake/frontmatter.ts` `stripTagsFromFrontmatter` | **stays TS** | test-only, no twin (11 Fork D) — the one file that keeps a TS export |
| `fake/links.ts` `outboundLinks` + per-link move math | **→ wasm kernel, consume** | pure link-extract + rewrite path-math twins (shared per [02](02-crate-packaging.md)); `links.ts` slims to orchestration, doesn't fully vanish |
| `fake/links.ts` `planRewrites` corpus walk | **stays TS orchestration** | twin of the *native* rename/move command (IO walk over the corpus), not a pure leaf |
| `fake.ts::search` ↔ `search.rs` | **stays TS** | ripgrep/ignore-walk is filesystem-bound; no pure shared source |
| `fake/render.ts` whole-doc HTML assembly | **stays TS stand-in** | comrak deferred out of v1 ([08](08-bundle-size-budget.md)); but its critic/citation/outline/frontmatter *inputs* consume the wasm kernels (13/11) — no re-impl of those |
| `fake/tree.ts` buildTree / rename / delete | **stays TS** | entangled with `FILES`/`FOLDERS` IO semantics; weak wasm candidate |
| `fake.ts::backlinks` / `allTags` / `conceptsByTag` | **stays TS orchestration** | native-index-command twins; corpus walk over Layer-1 kernels (`outboundLinks`, `parseFrontmatter`) |
| `fake/store.ts` `FILES`/`FOLDERS`/`conceptPaths()` | **stays TS** | fixture *source of truth* that FEEDS the wasm handle, not derived from it (map Notes counterweight: a util serving non-wasm data stays TS and is *fed* the wasm data) |
| `fake.ts` git seam (`fileHistory`/`fileAtRev`) | **stays TS** | canned test fixtures, no algorithm at all |

**Sequencing:** this ticket writes no code. The fake's Layer-1 consumption happens *inside*
the migration PRs that own each kernel (10 links, 11 frontmatter, 13 render-derived) — each
family PR flips the fake's imports to the shared barrel as part of its clean cut
([09](09-migration-sequencing.md)). 12 contributes no standalone PR; its output is this
disposition table, which the ADR ([17](17-adr-assembly.md)) folds into the migration-per-family
section as the "fake backend" column. This is why 12 blocks 17 but nothing else.

**No new tickets, no fog graduated, nothing ruled newly out of scope.** The `stripTags` /
search / tree / git-seam / store dispositions confirm existing exemptions; no residual
question remains for the fake backend.
