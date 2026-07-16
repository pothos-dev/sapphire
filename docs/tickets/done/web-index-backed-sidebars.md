## What to build

The index-driven Sidebar sections, read-only over HTTP: **Backlinks**, **Tags**,
and **Outline** work in the web viewer the same way they do on desktop, served by
the existing `sapphire-core` index.

- Expose the read-only index queries in `sapphire-server`: `backlinks`,
  `allTags`, `conceptsByTag`, `listConceptPaths`, `conceptExists` (and
  `allTypes`/`allKeys` if a consumer needs them). `http.ts` implements each.
- Reuse the existing `Backlinks`, `Tags`, and `Outline` components read-only:
  Backlinks lists Concepts linking to the open Concept; Tags lists bundle tags with
  counts and reveals Concepts under a selected tag; Outline lists the open Concept's
  headings and scrolls the rendered view to them. The Tags section stays hidden when
  the Bundle has no tags, as on desktop.
- Selecting a backlink or a tagged Concept navigates within the viewer. These views
  refresh on the live-reload change events.

Type: **AFK**.

## Acceptance criteria

- [ ] `backlinks`, `allTags`, `conceptsByTag`, `listConceptPaths`, `conceptExists` are served over HTTP and implemented in `http.ts`
- [ ] Backlinks section lists inbound linkers and navigates on selection
- [ ] Tags section lists tags with counts, reveals Concepts per tag, and is hidden when the Bundle has no tags
- [ ] Outline lists the open Concept's headings and scrolls the rendered view to a selected heading
- [ ] These sections refresh on live-reload change events
- [ ] `bun run check` and Rust tests green; a Playwright spec covers backlinks + tags + outline with a screenshot

## Blocked by

- web-server-side-render.md
