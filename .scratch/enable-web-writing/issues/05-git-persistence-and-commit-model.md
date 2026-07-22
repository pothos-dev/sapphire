# 05 — Git persistence & commit model

Type: grilling
Status: resolved
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

## Answer

Grounding fact found while resolving: **nothing in the codebase commits today.**
`git.rs` is a read-only seam (history + file-at-rev for the diff feature); the
desktop just writes files to disk. Web "git-backed Save" is net-new machinery,
which creates a deliberate desktop↔web asymmetry (desktop writes without
committing; web writes *and* commits). In-scope only for web.

### Commit boundary
**One commit = one Concept.** A text Save commits the active Concept's buffer —
one file, one commit. No "all dirty buffers in one commit" model.

### Commit messages
**Templated, no author-supplied text**, with per-operation verbs so history is
uniformly greppable (`--grep 'via web'` isolates web edits):

- `edit <path> via web`
- `create <path> via web`
- `rename <old> → <new> via web`
- `move <old> → <new> via web`
- `delete <path> via web`

The "who" is the commit author (OIDC identity); the "why" is rarely meaningful
for per-Concept wiki edits, so no message box.

### Text vs structural commit timing
- **Text edits** buffer until the explicit Save, then commit.
- **Tree CRUD** (create / rename / move / delete) commits **immediately**, one
  commit per op, with its link/anchor rewrites (`rewrite.rs`) folded into that
  same commit — so `rename <old> → <new> via web`'s diff *is* the move plus every
  link/anchor fixup. Not buffered behind the text Save.

### Structural-op safety — the stale-buffer hazard
A rename/move/delete rewrites links/anchors in *other* files on disk; if the
active buffer is one of them (or is otherwise dirty), the structural op would
stale the buffer under the user. Rule:

- A structural op requires a **clean active buffer**.
- Active buffer dirty → **confirmation dialog**. Confirm → flush-commit the
  buffer first (`edit <A> via web`), *then* run the structural op + rewrites
  (second commit). **Cancel → nothing happens**: no save, no structural op
  (atomic abort).
- Active buffer clean → structural op proceeds directly (one commit).
- **Invariant:** the web editor never holds more than one dirty buffer at a time;
  there are no hidden non-active dirty buffers for a rewrite to clobber.
  (Navigating away from an unsaved Concept must save/discard first — the precise
  affordance is editor-shell/Concurrency-UX work, not this ticket.)

### Push / pull — OUT OF SCOPE
The server owns its working tree exclusively and only **commits locally**. No
automatic push, no pull. Remote sync / replication / backup is a
**deployment-level** concern (e.g. an out-of-band cron `git push`, or hosting the
Bundle repo on backed-up storage) and touches the write path not at all. Returns
as a fresh effort if in-API push is ever needed. Ticket 02's push mechanics
(deploy key, deferred, `GIT_TERMINAL_PROMPT=0`) stand recorded but are unused by
this effort.

### Mechanism & authorship
- System **`git` CLI** (per ticket 02), extending the existing read-only `git.rs`
  seam with a commit path (reuse its `run_git` cwd=Bundle-root plumbing).
- Per op: `git add -- <path>...` then `git commit -m "<templated>"`.
- **Author = committer = OIDC `name`+`email`** (per ticket 04). This **overrides
  ticket 02's "fixed committer"** — ticket 04 is the authoritative identity
  decision. Set per-request via all four env vars
  `GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL`, which also frees the
  commit from any repo-level `user.name`/`user.email` config (robust on a fresh
  deploy). Commit **date** is git-stamped (real wall clock), no `GIT_*_DATE`.
- Every path the op writes — the Concept **and** every link/anchor-rewrite
  target — is passed through `AppState::note_self_write` **before** the write, so
  the server's own `notify` watcher events don't echo over SSE as bogus external
  changes (ticket 02's critical note; the suppression machinery already exists in
  `app_state.rs`, just unwired on a write path).

### Serialization
**One server-global write lock** wrapping each op's *entire*
write → (rewrite) → `git add` → `git commit` as a single critical section (one
Bundle = one working tree = one shared `index.lock`; finer granularity buys
nothing). Held across the whole op so a rename's multi-file rewrite is computed
and committed against a consistent tree, never interleaved with a concurrent
Save. Because git CLI calls block, the critical section runs on a blocking
thread (e.g. one `spawn_blocking` per op) rather than holding an async lock
across many awaits.

The lock **orders** writes and protects tree/index integrity — it is **not**
conflict detection. Conflicts are **last-write-wins** by design: the last
commit wins, both commits exist in history, and the losing client learns it was
stale via the SSE warn/reload flow (the separate **Concurrency UX** item, out of
this ticket).
