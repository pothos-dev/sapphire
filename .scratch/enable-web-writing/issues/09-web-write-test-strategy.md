# 09 — Web write test strategy

Type: grilling
Status: open
Blocked by: 07

## Question

The web write path is now specified (ticket 07). Decide how it is **tested**
against the project's four green gates + Playwright, given the seam has a real
`http.ts` and an in-memory `fake.ts`.

Resolve:

- **What the `fake` backend must model.** `fake.ts` is the Playwright/Chromium
  backend. Today its write methods back the desktop specs. For web-write specs it
  must model the *new* behaviours: does the fake need to model **commits** at all
  (e.g. a commit log the spec can assert on), or is committing purely a server
  concern the fake ignores (writes just mutate the in-memory Bundle)? How does the
  fake represent the amend-else-fresh anchor commit (ticket 07 §5) if commits are
  modelled?
- **Where each behaviour is proven.** Split across the gates: pure TS logic
  (`bun test src/lib`) vs Rust unit tests (`cargo test` — the new `git::commit`
  primitive + server orchestration + write classifier, temp-repo pattern) vs
  Playwright (the editor-shell island driving writes end-to-end over the fake).
- **Auth in tests.** The `AuthedUser` extractor / JWT gate (ticket 07 §3) — how do
  the Rust server tests exercise gated routes, and does Playwright (fake backend,
  no real axum) need to simulate auth at all?
- **The desktop↔web asymmetry** (desktop writes without committing; web writes +
  commits) — ensure the shared specs don't wrongly assert commits on the desktop
  target.

Record the decision under `## Answer`.
