## What to build

Server-side Concept rendering: replace the raw-markdown pane with a properly
**rendered read-only view**, produced by the server so all knowledge semantics stay
in one place (Rust owns them). The editor pane / CodeMirror is not used on the web.

- New `/api/render` route in `sunstone-server`: given a bundle-relative Concept
  path, render its markdown body to HTML (comrak) and return the HTML plus the
  parsed frontmatter and the document outline (headings in order).
- Link resolution reuses the existing `sunstone-core` index and wikilink logic:
  standard markdown links and `[[name]]` wikilinks resolve by the same rules as the
  desktop app (filename match, shortest-path/alphabetical tie-break, suffix match).
  Links to missing targets render visually distinct (broken-link styling) but remain
  present — broken links are tolerated per OKF.
- The web Concept view renders this HTML. Frontmatter shows through the reused
  read-only Properties view; the outline feeds the Outline section.
- SSR `load()` fetches the rendered payload so first paint shows the rendered
  Concept without waiting on client hydration. (Mermaid blocks are left as inert
  source here; their client-side hydration is a separate slice.)

Type: **AFK**.

## Acceptance criteria

- [ ] `/api/render` returns rendered HTML + frontmatter + outline for a Concept
- [ ] Markdown links and `[[wikilinks]]` resolve identically to the desktop rules; broken targets are styled distinct but present
- [ ] In-Bundle links navigate to the target Concept within the viewer (no browser navigation away)
- [ ] The web Concept view shows rendered HTML (no CodeMirror), with frontmatter via the read-only Properties view
- [ ] SSR first paint contains the rendered Concept HTML (verifiable in page source before hydration)
- [ ] `bun run check` and the relevant Rust tests are green; a Playwright spec covers rendered output + a broken link with a screenshot

## Blocked by

- web-readonly-api-walking-skeleton.md
