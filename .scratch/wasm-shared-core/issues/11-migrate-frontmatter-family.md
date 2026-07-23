# 11 — Migrate the frontmatter family (+ fate of the TS-only property model)

Type: grilling
Status: open
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
