## What to build

Bundle-wide full-text **Search** in the web viewer: the centered modal
(`Ctrl+Shift+F`) that scans every Concept body and lists path/line/snippet hits,
backed by the existing `sunstone-core` ripgrep search.

- Expose `search` in `sunstone-server` (case-insensitive literal query, results
  ordered by path then line, capped server-side as today). `http.ts` implements it.
- Reuse the existing Search modal as a hydrated interactive island: type a query,
  see matching Concepts with line + snippet, select a hit to open that Concept in
  the viewer at the match. Snippet match-highlighting reuses the existing pure
  highlight helper.
- Search is client-interactive (not SSR) — it hydrates and calls the Backend seam.

Type: **AFK**.

## Acceptance criteria

- [ ] `search` is served over HTTP (case-insensitive, ordered, capped) and implemented in `http.ts`
- [ ] `Ctrl+Shift+F` opens the Search modal in the web viewer
- [ ] Results list path + line + highlighted snippet; selecting a hit opens the Concept at the match
- [ ] An empty/whitespace query yields no matches
- [ ] `bun run check` and Rust tests green; a Playwright spec drives a search and opens a hit with a screenshot

## Blocked by

- web-readonly-api-walking-skeleton.md
