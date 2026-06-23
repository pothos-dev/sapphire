## What to build

Keep diagram rendering cheap and race-free across the field's frequent rebuilds (per option 9a in
[ADR-0005](../../adr/0005-mermaid-block-rendering.md)). The `StateField` rebuilds its decoration
set on every doc change (including edits *between* diagrams), and `mermaid.render()` is async.

- Implement `WidgetType.eq()` keyed on `(source + resolvedTheme)` so CodeMirror reuses existing
  DOM and unchanged diagrams never re-render on unrelated edits.
- Add a module-level `source → SVG` cache so an identical diagram (or one edited back to a prior
  state) paints instantly from memory instead of re-rendering.
- Use a per-widget generation token (incremented per render request) so a stale in-flight render
  resolving after a newer one is discarded rather than swapped in.

Type: **AFK**.

## Acceptance criteria

- [ ] Editing text outside a diagram does not re-render that diagram (verified via `eq()` DOM reuse)
- [ ] An identical diagram source paints from the cache without a fresh `mermaid.render()` call
- [ ] A fast source-change-then-revert never leaves a stale SVG displayed
- [ ] Cache/identity key includes the resolved theme so a theme flip still re-renders correctly
- [ ] `bun run check` and `cargo check` are green
- [ ] Unit tests cover the cache key/identity logic (pure parts) in the `.ts` module

## Blocked by

- docs/tickets/ready/mermaid-block-render.md
