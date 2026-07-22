# 07 — Server write-route surface & watcher self-write suppression

Type: grilling
Status: resolved
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

## Answer

A **RESTful-per-method write surface** on `sunstone-server`, mirroring the `Backend`
write methods 1:1 (the read routes already work this way). Auth is a **per-request
`AuthedUser` extractor** (ticket 04's hook-minted HS256 JWT); every write route
**write-then-commits immediately** (ticket 05 — there is *no* server-side "pending
Save"); the whole write→rewrite→commit runs under **one server-global write lock** on a
blocking thread. Self-write suppression is **already wired** in the shared watcher — the
write path just has to feed it.

### 1. Route table (mirror the seam 1:1)

All JSON bodies; paths bundle-relative, forward-slash, guarded exactly like the read
routes. All commit under the global lock (§4).

| Backend method | Verb + route | Request | Response | Commit message |
|---|---|---|---|---|
| `writeConcept(path, content)` | `PUT /api/concept` | `{ path, content }` | `204` | `edit <path> via web` |
| `createConcept(path)` | `POST /api/concept` | `{ path }` | `204` | `create <path> via web` |
| `createFolder(path)` | `POST /api/folder` | `{ path }` | `204` | `create <path> via web` |
| `renamePath(from, to)` | `POST /api/rename` | `{ from, to }` | `200 RewriteSummary` | `rename <old> → <new> via web` |
| `movePath(from, toDir)` | `POST /api/move` | `{ from, toDir }` | `200 RewriteSummary` | `move <old> → <new> via web` |
| `deletePath(path)` | `DELETE /api/concept?path=…` | — (query) | `204` | `delete <path> via web` |
| `rewriteAnchors(target, renames)` | `POST /api/rewrite-anchors` | `{ target, renames }` | `200 RewriteSummary` | amend `edit …`, else `relink <target> via web` (§5) |

- **`PUT` = overwrite existing content**, **`POST /api/concept` = create new empty
  Concept** — genuinely different ops (create rejects an existing target; write requires
  it) with different commit verbs, so kept as distinct verbs on the same noun.
- **`createFolder` gets its own `/api/folder` noun** so `POST /api/concept` stays
  unambiguously "new Concept."
- **`delete` via query param** (not a `DELETE` body — poorly supported through proxies;
  the read routes already pass `path` this way).
- **`rename`/`move` are verb-noun RPC** routes, not REST-on-a-resource — a rename is a
  bundle-wide op (rewrites *other* files), not a mutation of one resource.
- **`saveBundleState` is NOT on the surface** (§6).

### 2. Layering — who owns what

The server is the **sole committer** (desktop writes files but never commits — a
deliberate desktop↔web asymmetry, ticket 05). Split:

- **Commit *primitive* → `sunstone-core` `git.rs`.** A thin `git::commit(root, paths,
  msg, author, committer)` (+ an amend variant and a `git log -1` HEAD-subject/author
  read for §5) — *only* here because it must reuse `git.rs`'s private `run_git`
  (cwd=Bundle-root) plumbing, and it sits beside the already-shared `file_history` /
  `file_at_rev`. Unit-tested with a temp git repo (the pattern `git.rs` tests already
  use). The desktop links it but never calls it.
- **Write→commit *orchestration* → `sunstone-server`.** The lock, the sequencing, the
  self-write bookkeeping, the error mapping — all in the axum layer. It composes the
  unchanged, commitless core writers (`bundle::write_concept` / `create_*` / `delete_*`,
  `rewrite::rename_and_rewrite` / `move_into` / `rewrite_anchors`) then calls
  `git::commit`.
- **File writes + link/anchor rewrites → `sunstone-core` (`bundle.rs`, `rewrite.rs`),
  unchanged** — already shared, already `note_self_write`-aware.

### 3. Auth enforcement — `AuthedUser` extractor

A custom axum `FromRequestParts` extractor `AuthedUser` verifies the hook-minted **HS256
JWT** (shared secret from env) and yields `{ name, email }`. Every write handler takes
`AuthedUser` as an argument → gating is provable from the signature; **read handlers omit
it and stay open**. The identity flows straight into the commit author/committer (ticket
04 §5: author = committer = OIDC `name`+`email`, set via `GIT_AUTHOR_*` /
`GIT_COMMITTER_*` env on the `git::commit` call). A missing/invalid/expired token → the
extractor rejects with **401** (never reaches the error classifier).

**`/api` proxy forwarding (folds in ticket 04 §8 + the fog item).** `hooks.server.ts`
today forwards no body/auth and only GET-shaped reads. On a **write** request (a
non-GET to `/api/*`, or the write route set) it must: resolve the Auth.js session cookie →
user; **only if valid**, mint the ~60s HS256 JWT and forward `method` + `Content-Type` +
**body** + `Authorization: Bearer <jwt>` to axum. Reads forward unchanged (no body, no
auth). axum binding to loopback becomes optional defense-in-depth (axum self-defends via
the JWT).

### 4. Commit trigger + serialization

**Every write route write-then-commits immediately. There is no server-side pending
Save** — text-edit buffering is entirely client-side; the editor's **Save** *is* the
`PUT /api/concept` call, which writes + commits in one shot. So the ticket's
"write-then-commit vs write-into-pending-Save" question resolves to: **all
write-then-commit.**

- Text edit: `PUT /api/concept` → `bundle::write_concept` → commit `edit … via web`.
- Structural (create/folder/rename/move/delete): the core op (with its link/anchor
  rewrites folded in for rename/move, per ticket 05) → **one** commit whose diff *is* the
  op plus every fixup.
- **One server-global write lock** (owned in `ServerState`) wraps each op's entire
  write → (rewrite) → `git add` → `git commit` critical section (one Bundle = one working
  tree = one shared `index.lock`). Because git CLI calls block, the section runs on a
  blocking thread (`spawn_blocking` per op), not holding an async lock across awaits. The
  lock **orders** writes and protects tree/index integrity; it is **not** conflict
  detection — conflicts are last-write-wins (SSE warn/reload is the separate Concurrency
  UX ticket).

### 5. `rewriteAnchors` — editor-driven by necessity, amend-or-fresh commit

**Why the editor must call it (not automatic on `writeConcept`):** confirmed against
`src/lib/editor/anchor-tracking.ts`. The editor tracks each heading's **identity** by its
line-start position carried through every CodeMirror transaction, plus its baseline slug;
on save `pendingAnchorRenames` reports a heading that kept its identity but changed slug
as a rename `{ from, to }`. The backend, handed only the new file *content* by
`writeConcept`, **cannot** distinguish `## Installation` → `## Setup` (a rename whose
inbound `#installation` links should follow) from delete-old + add-new (links legitimately
break). That rename identity is ephemeral editor state that never crosses the seam as
content — so anchor rewrite is structurally editor-driven. (Contrast: file rename/move
*is* automatic backend rewrite, because there the old→new identity is passed explicitly.)

**Commit boundary — amend-else-fresh.** The editor fires `writeConcept` then
`rewriteAnchors` back-to-back. Rather than always producing two commits, the
`rewrite-anchors` handler, **inside the global write lock**:

1. Reads `HEAD` (subject + author name+email) via the `git.rs` primitive.
2. **Amends iff** `subject == "edit <target> via web"` **and** author == the current JWT
   identity → `note_self_write` + write the relink targets, `git add`, `git commit
   --amend --no-edit` (preserves original author + author-date; only tree + committer-date
   move). Result: **one** commit whose diff is "the edit plus its relinks" — consistent
   with ticket 05's structural-op fold (induced rewrites join the triggering commit).
3. **Otherwise a fresh commit** `relink <target> via web`. This safely covers every
   hazard: another client's write landed between save and rewrite (HEAD won't match),
   `rewriteAnchors` fired without a preceding save, etc. We never amend someone else's
   commit; last-write-wins preserved.

**Safe because push is out of scope** (ticket 05): `--amend` only rewrites the tip of
*local, unshared* history — no force-push / collaborator-clone hazard. If we ever push,
amend must be revisited.

### 6. `saveBundleState` — off the surface (it is View state, not Bundle state)

`saveBundleState` persists per-user UI state (last-open Concept, expanded folders, sidebar
flags, geometry) that is **never** written into the Bundle and has nothing to do with git.
On the web the server serves **one** Bundle shared by **all** users, so a bundle-keyed
server store would have one user clobber another's — it is inherently *per-user,
per-browser*. So: **no `/api/bundle-state` write route**; it does not commit; its web home
is client-side (`localStorage`) or deferred — a frontend / editor-shell concern, not this
surface. **Flagged a domain-term mismatch** (`BundleState`/`save|loadBundleState` misnames
per-user browser state after the git-committed **Bundle**): recorded in
`docs/GLOSSARY.md` → *Flagged ambiguities*, resolved term **View state**, code rename
deferred to a later slice.

### 7. Self-write suppression — already wired; feed it

**Grounding fact:** the server already reuses the shared `watcher::start(root, app_state,
sink)`, and `watcher.rs::handle_event` **already** consults
`AppState::is_recent_self_write` per path *before* invoking the sink. So suppression
machinery exists end-to-end; the read-only server simply never had a writer to feed it
(the "no self-write suppression matters here" comment in `main.rs` is stale-in-waiting).

Requirement for the write path (ticket 05): call `state.app.note_self_write(abs)` for
**every** path an op writes — the Concept **and** every link/anchor-rewrite target — so
the server's own `notify` events don't echo over SSE as bogus external changes.
`rewrite.rs` already `note_self_write`s its rewrite targets; the orchestration must do the
same for the primary written path. Update the stale `main.rs` comment. (`FileChange`
batches multiple paths, but `handle_event` filters per-path before assembling the event,
so batching is already handled.)

> **⚠️ REVISED by [ticket 08](08-web-write-concurrency-ux.md).** This section is
> **wrong for the web write path.** `watcher.rs` suppresses a self-written path
> *before the broadcast*, so `note_self_write` drops the SSE event for **every**
> subscriber, not just the writer — other browsers would never see a web edit, and
> the destination's "last-write-wins **+ live refresh**" would be dead. The suppression
> is correct for the **single-user desktop** only. **Web fix (ticket 08 §1): do NOT
> `note_self_write` on the web write path; instead stamp the broadcast with an
> `origin: {clientId, author.name}` and let each browser drop the echo of its own
> `clientId` client-side.** `FileChange` grows an `origin` field; the write route
> forwards the client's `clientId` and stamps the OIDC identity. The desktop path is
> unaffected (keeps `note_self_write`).

### 8. Error taxonomy — separate write classifier

Write routes have different failure semantics than reads (a read miss is `404`; a write's
default failure is a *server* fault). Add a **separate** write classifier (reads keep
theirs, default `404`; writes default `500`):

| Core message substring / source | Status | Meaning |
|---|---|---|
| `escapes the bundle` / `must be bundle-relative` / `must end in .md` | **400** | invalid path (client) |
| `already exists` | **409** | create/rename onto existing target (conflict) |
| `does not exist` (missing source / `target folder does not exist`) | **404** | referenced path/parent not found |
| IO failure (`Permission denied`, disk…), `git::commit` failure, poisoned lock | **500** | server fault |
| missing/invalid/expired JWT | **401** | from the `AuthedUser` extractor; never reaches `classify` |

### Graduation

- **Now fully specified → build/handoff** (no decisions left; not decision tickets):
  `http.ts` write impl (mirror this table, drop the `READ_ONLY` rejections), the
  server-side write route + Tree-CRUD-over-HTTP implementation, and the `/api` proxy
  write-forwarding (§3).
- **New decision tickets** (graduated from fog): **[08 — Web write concurrency UX]** and
  **[09 — Web write test strategy]**.
- **Still fog:** deployment / ops (Node SSR + axum process topology, JWT secret + OIDC
  provider provisioning, env/config) — genuinely operator-dependent, kept in *Not yet
  specified*.
