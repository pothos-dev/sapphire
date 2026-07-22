# 05 — Git persistence & commit model

Type: grilling
Status: open
Blocked by: 02, 04

## Question

Pin down exactly what "git-backed, explicit save/commit" means as a mechanism.

Resolve:

- **The commit boundary.** Autosave stays disabled/off on web (decided); a Save action
  writes the working tree and commits. What exactly is one commit — one Concept, or all
  dirty buffers in a session? What's the commit message (author-supplied? templated
  `edit <path> via web`?).
- **Structural ops.** Do Tree CRUD operations (create/rename/move/delete, which also
  rewrite links) commit **immediately** (they're not buffered like text edits), or are
  they also gated behind Save? Likely immediate — confirm and specify the commit shape.
- **Push.** Is push in scope for the destination, and if so: to which remote, on every
  commit or deferred, and what happens on push failure? (Ties to ticket 02's credential
  findings.) If deferred to a later effort, rule it out of scope here.
- **Commit mechanism** — CLI vs `git2`/`gix`, and per-request authorship wiring (from
  ticket 02 + the identity decision in ticket 04).
- **Serialization** — how concurrent Saves from two users are ordered safely.

Record the decision under `## Answer`. Feeds the write-route surface (ticket 07).
