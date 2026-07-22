# 08 — Web write concurrency UX

Type: grilling
Status: resolved
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

## Answer

### Grounding fact — ticket 07's echo suppression breaks multi-user live refresh
Traced while resolving: **the server's self-write suppression is global, not
per-connection.** The write path (tickets 05/07) calls `note_self_write(path)`;
`watcher.rs:97` checks `is_recent_self_write` **before the change reaches the
sink** — i.e. before it is pushed into the single `tokio::sync::broadcast`
channel (`main.rs:82-87`). Suppress-before-broadcast drops the event for **every**
SSE subscriber, not just the writer. So under ticket 07 as written, browser A's
Save reaches **no** other browser: the destination's "last-write-wins **+ live
refresh**" is unimplementable and ticket 08's fifth-bullet premise ("*other
browsers still receive them*") is false. The suppression was built for the
single-user **desktop** (don't echo my own autosave back to me); web needs the
inverse — broadcast to everyone, each browser ignores the echo of its **own**
write. **This revises ticket 07** (see its Answer's correction note).

### 1 — Echo suppression via a server-stamped origin (NOT client-side timing)
Chosen over a client-side self-write window because a correlation id also gives
write **attribution** now and a hook for future realtime/presence.

- `FileChange` grows from `{kind, paths}` to **`{kind, paths, origin}`**.
  `origin = { clientId: string, author: { name: string } }` on a web write;
  **`origin: null`** for a non-web / external edit (always treated as genuine).
- **Server:** on the web write path, **do NOT `note_self_write`** — let every
  write fan out over SSE to all subscribers, writer included. Stamp the broadcast
  with the originating `clientId` (forwarded from the client on the write request)
  and the OIDC `author.name` (already in hand server-side for the git author, per
  tickets 04/05 — nearly free).
- **Client:** each browser drops any incoming `FileChange` whose
  `origin.clientId === myClientId` (it already has that content). Everyone else's
  browsers treat it as a genuine external change → detection/flow below.
- **`clientId` scope:** minted **per browser tab, in-memory** (dies with the tab).
  Two tabs in one browser are independent writers — correct last-write-wins
  semantics (tab B should reload on tab A's write). NOT persisted in
  `localStorage` (would wrongly suppress cross-tab).
- Reads broadcast no origin; only writes carry one.

### 2 — Stale detection = path-match routing
After dropping self-echoes, route a genuine `FileChange` by path:

- **`paths` includes the active Concept's path** → active buffer affected → hand
  to the clean/dirty flow (§3).
- **`paths` touches only other files** → **no buffer action**; refresh the
  read-only surfaces only (tree, backlinks, tags, rendered links) — exactly what
  `WebViewer`'s `onFileChanged` does today (`invalidateAll()` + `indexVersion++`).
- **`kind: 'removed'` on the active path** → distinct **"This Concept was deleted
  (by X)"** state (not a reload — nothing to reload to). A **dirty** buffer becomes
  an orphan the user can discard or **re-create via Save** (Save on a deleted path
  = `create … via web`); a **clean** buffer drops back to the viewer/empty state.
- **`kind: 'created'`** matching the active path → treat as `modified`.
- **Remote rename/move of my open Concept** surfaces as `removed(old)` (no rename
  semantics in `FileChange`) → falls into the deleted state above. **Accepted** as
  rare under last-write-wins; NOT worth carrying rename semantics in the payload.

### 3 — Warn/reload flow: clean silent, dirty modal
- **Clean buffer** (nothing at risk) → **silent reload** from disk (desktop
  `reloadExternal()` behaviour) + a subtle **non-blocking notice** "*Updated by
  <origin.author.name>*" (just "changed on disk" when `origin` is null). No modal.
- **Dirty buffer** → **blocking modal conflict dialog**:

  > **"<Concept> was changed by <name>."**
  > Your unsaved edits conflict with a newer version on the server.
  > - **[Discard my changes & reload]** — drop edits, load their version; buffer clean.
  > - **[Keep my changes]** — dismiss; buffer stays dirty. **Next Save overwrites
  >   their version** (last-write-wins).

  - **Repeated changes:** each further genuine external change to the active dirty
    buffer **re-raises** the dialog (debounced against a burst); "keep mine" just
    re-arms.
  - **No diff / no merge** — binary discard-vs-keep (3-way merge is out of scope).

### 4 — Leaving a dirty buffer (ticket 05 deferred)
No autosave on web, so every exit past a dirty buffer must resolve it.

- **In-app exits** — switching Concept (tree click / wikilink) **or** toggling Edit
  off — → **three-way modal**: **"Save changes to <Concept>?"** →
  **[Save]** (commit, then proceed) / **[Discard]** (drop edits, proceed) /
  **[Cancel]** (stay put).
- **Tab close / reload / browser nav** → native **`beforeunload` guard**, armed
  only while the buffer is dirty, disarmed the instant it's clean. (Can't customise
  text or save from it — browsers forbid it; pure last-ditch "are you sure".)
- **Ticket 06 toggle:** reads **"Done"** when the buffer is **clean** (exit to
  viewer, no dialog) and **"Save"** when **dirty** (its click *is* the Save path,
  no ambiguity). The three-way dialog fires only on the **implicit** exits above.

### 5 — Structural-op-while-dirty dialog (concrete form of ticket 05's policy)
Trigger: a **rename / move / delete** initiated from the tree while the active
buffer `<A>` is dirty.

> **"Save <A> before <renaming/moving/deleting> <B>?"**
> This action also updates links across the Bundle and can't run with unsaved changes open.
> - **[Save & continue]** — commit `<A>` (`edit <A> via web`), then the op (2nd commit).
> - **[Discard & continue]** — drop `<A>`'s edits, then the op (one commit).
> - **[Cancel]** — nothing happens: no save, no op (atomic).

- **Adds "Discard & continue"** to ticket 05's Save/Cancel — consistent with §4,
  coherent (dropping `<A>` before the op is safe whether or not `<A>` is among the
  rewritten files). **Refines** ticket 05; Cancel still aborts both.
- **Create is exempt from the clean-buffer gate** — it rewrites no existing file
  and can't stale the active buffer; it commits `create <path> via web` immediately
  and leaves the dirty buffer untouched. The gate is **rename/move/delete only**.
