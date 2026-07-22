# 08 — Web write concurrency UX

Type: grilling
Status: open
Blocked by: 06, 07

## Question

Ticket 05 fixed the *policy* — **last-write-wins**, no locking/merge, the SSE
broadcast warns/reloads a stale buffer — and explicitly deferred "the precise
affordance" to Concurrency-UX work. Ticket 07 fixed the server side (every write
commits; the server `note_self_write`s its own writes so its edits **don't** echo
over SSE). This ticket designs the **client-side** last-write-wins experience in
the web editor shell (ticket 06's single-Tile island).

Resolve:

- **Stale-buffer detection.** The web editor holds ≤1 dirty buffer (ticket 05). A
  genuine external change arrives over the existing `/api/events` SSE
  (`onFileChanged`). How does the client decide the *active buffer* is now stale —
  match the changed path against the open Concept? What about a change to a file
  the buffer isn't editing (tree refresh only)?
- **Warn / reload flow.** When the open Concept changed on disk under a **clean**
  buffer vs a **dirty** buffer — reload silently? banner + explicit reload?
  block-and-choose (keep mine / take theirs)? Last-write-wins means "theirs" is
  already committed; "keep mine" just means the next Save wins.
- **Navigate-away-with-dirty-buffer** (ticket 05 deferred): moving to another
  Concept / toggling Edit off with unsaved changes must save-or-discard first —
  the exact affordance.
- **Structural-op-while-dirty** confirm dialog (ticket 05's flush-commit-then-op,
  cancel aborts both) — its concrete UX in the web shell.
- **SSE echo after our own Save.** The server suppresses its *own* writes, but
  *other* connected browsers still receive them — confirm the flow reloads their
  clean buffers and warns their dirty ones without a feedback loop.

Record the decision under `## Answer`.
