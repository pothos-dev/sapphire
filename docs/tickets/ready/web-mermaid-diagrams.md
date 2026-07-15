## What to build

Render Mermaid **Diagrams** in the web viewer. Mermaid is a client-side library, so
its fenced code blocks — left as inert source by the server renderer — hydrate into
rendered diagrams in the browser.

- A client-side island scans the rendered Concept HTML for ` ```mermaid ` blocks and
  renders each into a Diagram after hydration, consistent with the desktop's
  live-preview diagram behavior (a fenced code block in source, a Diagram when
  rendered). Diagrams are excluded from the Outline, like all fenced code.
- Re-render diagrams when the open Concept changes (navigation) and on live-reload
  change events. Light/dark follows the same theme source as the rest of the viewer.
- A malformed diagram fails gracefully (shows an error/placeholder, never breaks the
  page).

Type: **AFK**.

## Acceptance criteria

- [ ] `mermaid` fenced blocks in a rendered Concept display as Diagrams after hydration
- [ ] Diagrams re-render on Concept navigation and on live-reload
- [ ] Diagram theme matches the viewer's light/dark theme
- [ ] A malformed diagram degrades gracefully without breaking the page
- [ ] `bun run check` green; a Playwright spec renders a Concept containing a Diagram with a screenshot

## Blocked by

- web-server-side-render.md
