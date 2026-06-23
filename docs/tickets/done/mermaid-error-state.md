## What to build

Give mermaid blocks a clear failure state when the diagram source is invalid (per option 4a in
[ADR-0005](../../adr/0005-mermaid-block-rendering.md)). A half-typed or malformed diagram is
invalid most of the time the cursor sits just outside it, so the failure must be informative
rather than blank.

When `mermaid.render()` throws (parse/render error), the widget shows a bordered error panel
containing mermaid's error message, with the raw fence source rendered beneath it — so the user
can see both what is broken and what they typed, and fix it without hunting for `edit` mode. A
broken diagram must be visibly distinct from a code block that simply has no renderer.

Type: **AFK**.

## Acceptance criteria

- [ ] An invalid mermaid block renders a bordered error panel showing mermaid's error message
- [ ] The raw fence source is shown beneath the error panel
- [ ] Fixing the source (cursor leaves the block) re-renders the diagram, clearing the error
- [ ] The error state is visually distinct from a normal fenced code block
- [ ] `bun run check` and `cargo check` are green
- [ ] A Playwright test enters invalid mermaid syntax and asserts the error panel + source are shown

## Blocked by

- docs/tickets/ready/mermaid-block-render.md
