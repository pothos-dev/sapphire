# 07 — Server write-route surface & watcher self-write suppression

Type: grilling
Status: open
Blocked by: 04, 05

## Question

Design the authenticated **write route table** on `sunstone-server`, mirroring the
`Backend` write methods that `http.ts` currently rejects.

Resolve:

- **The route surface.** Which endpoints, verbs, and shapes back `writeConcept`,
  `createConcept`, `createFolder`, `renamePath`, `movePath`, `deletePath`,
  `rewriteAnchors`, `saveBundleState` — reusing the existing `sunstone-core` write /
  rewrite logic (`bundle.rs`, `rewrite.rs`) the desktop already uses.
- **Auth enforcement** on each write route (from ticket 04) and the **commit trigger**
  wiring (from ticket 05) — which routes write-then-commit vs write-into-a-pending-Save.
- **Self-write suppression.** The read-only server never wrote, so its watcher had
  nothing to suppress; now that the server writes, its own edits will fire `notify`
  events and echo over SSE as bogus "external changes." Specify how the server tracks
  and suppresses self-writes (mirroring the desktop `AppState` self-write tracker).
- **Error mapping** — extend the existing `ApiError` classification (400 path-escape /
  404 missing) for write failures (conflict, target exists, write-perm).

Record the decision under `## Answer`. Once resolved, it graduates the fog items
(http.ts write impl, Tree CRUD over HTTP, concurrency UX) into tickets.
