## What to build

Record the architectural change to the frontmatter model in the ADR log. `docs/adr/0002-flat-frontmatter-model.md` documents a verbatim, byte-for-byte preservation round-trip (editing one field leaves all other YAML — comments, quoting, formatting — untouched). The new model re-serializes the whole frontmatter block from structured `Property[]` on every change, which intentionally drops that guarantee.

Write a new ADR that supersedes 0002: explain the move to a structured single-source-of-truth frontmatter (`Property[]` in a CodeMirror `StateField`) with whole-block re-serialization, why the verbatim guarantee was traded away (enables add/delete/rename, structured editing, and unified undo), and how conformance is still met — `type` non-empty and unknown/complex values re-emitted faithfully from their stored `raw` text (OKF §9, see docs/okf-spec.md). Mark ADR-0002 as superseded with a link to the new ADR. Link docs/okf-spec.md as the format reference.

## Acceptance criteria

- [ ] A new ADR exists describing the structured/re-serialized frontmatter model and the dropped verbatim guarantee, with rationale.
- [ ] ADR-0002 is marked superseded and links to the new ADR.
- [ ] The new ADR references docs/okf-spec.md and explains how OKF conformance is preserved (required `type`, unknown keys preserved).

## Blocked by

None - can start immediately
