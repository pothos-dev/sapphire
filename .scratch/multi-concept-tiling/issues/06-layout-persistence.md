# 06 — Layout persistence

**What to build:** The tiled workspace survives a relaunch. On restart you get
your columns and tiles back: each tile's Concept path and its per-pane view-mode,
plus the divider sizes. The old single-Concept session (`lastOpenConcept`, one
`editorMode`) migrates to a single tile. Per-pane navigation history and
scroll/cursor position are intentionally NOT persisted (they stay ephemeral, as
today) — a restored tile starts with a fresh one-entry history.

**Blocked by:** 03 — Tiling, dividers, Split & close; 05 — Satellite views follow
the active pane (so per-tile mode and the global Properties flag are part of the
persisted shape).

**Status:** ready-for-agent

- [ ] The full layout tree — columns, each tile's `{path, mode}`, and divider
      sizes — is persisted per-Bundle via the existing `session` seam.
- [ ] On launch the workspace is reconstructed from the persisted layout.
- [ ] An old session with only `lastOpenConcept` (+ single `editorMode`) migrates
      cleanly to a single tile; a missing/corrupt layout falls back to one empty
      pane without error.
- [ ] The global Properties toggle state persists across relaunch.
- [ ] Per-pane history and scroll/cursor are NOT persisted; restored tiles start
      with a fresh one-entry history.
- [ ] `bun test src/lib`, `bun run check`, `cargo test`, `cargo check` green;
      a Playwright spec (or a session round-trip unit test) verifies layout
      restore + old-session migration, saving a screenshot.
