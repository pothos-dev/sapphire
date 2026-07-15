## What to build

Live reload for all viewers: when Concepts change on disk (edited by any external
tool, since the web app itself never writes), every connected browser updates
without a manual refresh. This maps the desktop's watcher event onto a web-native
push channel.

- New `/api/events` route in `sapphire-server` streaming filesystem changes as
  Server-Sent Events (`text/event-stream`). The `sapphire-core` watcher's change
  events are broadcast to every connected client (a broadcast channel drained per
  connection). No self-write suppression is needed — the web app has no write path,
  so every change is a genuine external edit worth delivering.
- `http.ts` implements `onFileChanged` over `EventSource`, returning an unsubscribe
  that closes the stream, matching the seam's synchronous-unsubscribe contract.
- The viewer reacts to changes: the open Concept re-renders, and the tree / index
  views refresh, consistent with how the desktop app reacts today.
- Multiple simultaneous viewers each receive the same change events.

Type: **AFK**.

## Acceptance criteria

- [ ] `/api/events` streams created/modified/removed changes as SSE with bundle-relative paths
- [ ] `http.ts` `onFileChanged` subscribes via `EventSource` and unsubscribes cleanly
- [ ] An external edit to the open Concept re-renders it in the viewer without manual refresh
- [ ] An external create/delete refreshes the tree
- [ ] Two concurrent viewers both receive the same change events
- [ ] `bun run check` and Rust tests green; a Playwright spec exercises a simulated change event with a screenshot

## Blocked by

- web-readonly-api-walking-skeleton.md
