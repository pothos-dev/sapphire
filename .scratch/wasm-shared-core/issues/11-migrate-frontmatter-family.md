# 11 — Migrate the frontmatter family (+ fate of the TS-only property model)

Type: grilling
Status: resolved
Blocked by: 03, 04, 09, 10

## Question

Disposition of frontmatter logic.

Twins to migrate: `ipc/fake/frontmatter.ts` (index parse: `parseFrontmatter`,
`parseFrontmatterFields/Keys`, `yamlValues`, `scalarString`) and `frontmatter.ts`
split/strip (`splitFrontmatter`, `frontmatterLineCount`) ↔ `index/frontmatter.rs`,
`render.rs` frontmatter fns.

Open sub-decision: `frontmatter.ts`'s round-trip **property model** (`parseProperties`,
`classify`, `serializeFrontmatter`, `renameProperty`, …) has **no Rust twin** — it's
the editor's byte-preserving YAML round-trip (ADR 0003). Decide: write it in Rust to
delete the TS (consistency, but new Rust + the byte-preservation guarantee must port),
or keep it TS (it's editor-only, no drift partner). Classify each fn.

## Answer

> Confirmed live 2026-07-23. Both forks resolved as recommended: property model
> **keeps TS**, `splitFrontmatter` **migrates to wasm**. Consumers verified.

**Four-way split of the family, by the effort's migration criterion:**

### A. Index-parse twins → **migrate to wasm** (single source; (a)-criterion)

`ipc/fake/frontmatter.ts`: `parseFrontmatter` (type+tags), `parseFrontmatterFields`,
`parseFrontmatterKeys`, `yamlValues`, `scalarString` — genuine twins of
`index/frontmatter.rs::parse_frontmatter` + `render.rs::{frontmatter_fields,
yaml_values, scalar_string}`. Consumed **only by the fake backend** simulating native
index/render queries. Fake calls the shared wasm source; delete the TS copies + tests.
Boundary shape = per-call (content-in / struct-out); `FrontmatterField` is already a
tsify-canonical DTO (ticket 06). Confirms 07's constraint that the fake consumes the
shared source.

### B. `splitFrontmatter` (+ `frontmatterLineCount`) → **migrate to wasm**

Real twin of `split_frontmatter` (impls have already drifted in shape; an offset bug
was fixed Rust-side). Foundational body/yaml boundary needed by the index, outline
(ticket 13), the fake (`links`/`render`/`frontmatter`), and Tile. Pure **free** wasm
export (no `BundleIndex` handle needed) returning the `SplitConcept` shape (verbatim
open/yaml/body/close slices, so byte-preservation holds). `frontmatterLineCount` folds
in (newline count over open+yaml+close) — exact shape (extra field vs 2-line TS helper)
left to 13/impl. **Not** per-keystroke for the property model: `joinConcept`/
`serializeFrontmatter` don't split; `parseProperties` splits only on Concept-load.

### C. Property model → **keep in TS** (the `fuzzy.ts` analogue)

`parseProperties`, `classify`, `entryText`, `serializeFrontmatter`, `joinConcept`,
`renameProperty`, `isTypeMissing`, `serializeKey/Scalar/List`, `needsQuoting`,
`titleFromFilename`, `scaffoldConcept`, `scalarKeyString`, `rangeText`. Fails **both**
migration prongs: no Rust twin (a), and it's *fed a content string* — it doesn't
operate over wasm-resident index state (b). Two hard blocks against porting:
1. **Byte-preservation (ADR 0003) rides on the `yaml` npm CST source tokens.**
   `serde_yaml` is a value parser with no source spans — porting means a new
   CST-preserving Rust YAML crate + re-verifying byte-exact round-trip. Large new
   surface, zero drift-kill.
2. **Hot path.** `serializeFrontmatter`/`joinConcept` run per-keystroke in
   `cm.ts` (onChange listener + dirty-check). Porting puts a `Property[]` marshal on
   every keystroke for no benefit.
Consumes wasm's `splitFrontmatter` (B) on Concept-load. Editor keeps the `yaml`
dependency. (Hybrid rejected: splitting one cohesive round-trip module across the seam
for a few parser-agnostic helpers isn't worth the fragmentation.)

### D. `stripTagsFromFrontmatter` → **keep TS**, flag to ticket 12

Test-only fake affordance (backs `clearAllTags`), line-based, no Rust twin — it
simulates a native rewrite. Fork-B shaped; disposition belongs with the rest of the
fake stand-ins in [12](12-migrate-fake-backend-standins.md).

**Cut-over (per 09/07):** one PR — land the index-parse fns + `splitFrontmatter` in
`sunstone-shared`, wire the fake to the shared source + expose the free split export,
run the fake-frontmatter goldens + `split_frontmatter` tests through wasm once for
byte-identical confirmation, then delete the TS twins + tests. Property model + its
tests untouched. Feeds ticket 12 (fake stand-ins consume the shared source, incl.
`stripTagsFromFrontmatter` disposition) and ticket 13 (outline uses wasm `splitFrontmatter`
+ `frontmatterLineCount`).
