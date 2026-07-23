# 13 — Migrate render-derived pure family + define the CM-decoration seam

Type: grilling
Status: open
Blocked by: 03, 04, 09, 10

## Question

Disposition of the pure scanners that live in/near `render.rs` and their CodeMirror
decoration halves.

Pure kernels to migrate (delete TS): outline (`outline.ts` `scanHeadings`/
`findHeadingLine` + the 3rd copy in `fake/render.ts::headingMatch`), CriticMarkup
**parse** (`editor/criticMarkup.ts` `parseCriticMarks`/`pairAnnotations`/`annotationAt`),
citations (`citations.ts` `findCitationRefs`/`citationDefPos`), conceptUrl
(`web/conceptUrl.ts`) ↔ `render.rs` twins.

**Constraint from [08](08-bundle-size-budget.md)**: comrak/render is deferred out of
wasm v1 (size). So **outline must be a pure string scan** (not derived from a comrak
parse) to migrate without dragging comrak in — matches `outline.ts`'s existing regex
scan, not `render.rs::build_outline`'s node walk. Confirm the pure-scan port stays
byte-identical to the Rust outline.

Define the **seam** for the parts that stay TS because they're CodeMirror-entangled:
the CriticMarkup decoration/edit-op layer (`criticMarkupView.ts`, `changeMarkDecorations`,
`insertHighlightComment`, …), the citation superscript widget, the broken-link marks.
These stay TS but must sit thinly over the wasm parse output — specify that interface.
