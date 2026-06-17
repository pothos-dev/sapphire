## What to build

Stop rendering the YAML frontmatter block inside the markdown editor. The CodeMirror document holds **only the body**; the frontmatter becomes structured `Property[]` state owned by a CodeMirror `StateField` (the single source of truth for frontmatter). The Properties panel is the only place frontmatter is edited.

On load, a concept is split into frontmatter + body: the body goes into the CM doc, the parsed `Property[]` goes into the frontmatter field. On save, the two are recombined into the full markdown: `serialize(props)` + body.

This replaces the byte-range splicing round-trip with a **whole-block re-serializer**: a pure function `Property[] → YAML block`. The verbatim-preservation guarantee is intentionally dropped (see the ADR-supersede ticket). Scalars and flat lists are re-serialized from their structured form; `complex` properties (block scalars, nested maps, multi-line strings) and any unknown keys are re-emitted faithfully from their stored `raw` text so conformance (§9: `type` non-empty, unknown keys preserved) holds.

Existing Properties edits (scalar text, list chips) are rewired: instead of producing new full-content via `setScalar`/`setList`, they dispatch a `setFrontmatter` effect that updates the frontmatter field. A reactive bridge mirrors the field value out so the panel can render it; writes go in via `dispatch(setFrontmatter.of(next))`.

## Acceptance criteria

- [ ] Opening a concept shows only the markdown body in the editor — the `---` block and YAML keys no longer appear in the editor text.
- [ ] The Properties panel renders the parsed frontmatter exactly as before (scalars, lists, complex read-only fields).
- [ ] Editing the body and editing a property both persist to disk as one valid markdown file (`serialize(props)` + body), and reloading reproduces the same panel + body.
- [ ] A `complex` value (e.g. a nested map or multi-line string) and an unknown key survive a property edit elsewhere in the document, re-emitted from their `raw` text.
- [ ] A concept with no frontmatter loads with an empty panel and the full text as body; one with malformed/unclosed frontmatter is treated as body-only (matching current `splitFrontmatter` behavior).
- [ ] Frontmatter changes flow through the existing autosave/flush path.

## Blocked by

None - can start immediately
