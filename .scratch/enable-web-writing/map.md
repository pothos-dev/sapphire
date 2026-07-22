# Enable writing on the web

## Destination

Sunstone Web today is **read-only by design** — the axum `sunstone-server` exposes
only read routes, `http.ts` hard-rejects every write with `READ_ONLY`, and the web
UI (`src/lib/web/`) is a server-rendered HTML *viewer*, not the CodeMirror editor.

The destination: **a handful of authenticated users can edit a shared Bundle from
the browser using the real CodeMirror editor, with edits persisted as git commits.**
Locked scope (from the charting grill):

- **Writers/auth:** few *known, authenticated* users, all editing the same Bundle.
  No per-user branching, no realtime merge.
- **Editing surface:** bring the real desktop CodeMirror + atomic-editor editor to
  the web (parity), not a lightweight textarea.
- **Persistence:** **git-backed** — writes land, then commit. **Explicit
  save/commit only** (a Save action), *not* per-autosave — no commit storm.
- **Concurrency:** **last-write-wins + live refresh** — the existing SSE broadcast
  warns/reloads a stale buffer. No locking, no merge.
- **Write scope:** edit Concept body + frontmatter; full Tree CRUD (create / rename
  / move / delete); anchor & link rewrite on rename — all mirrored server-side with
  commits.

The map is done when every decision above is pinned precisely enough that a builder
can implement web writing without further design choices.

## Notes

- **Domain:** read `docs/GLOSSARY.md` (Bundle, Concept, Wikilink, Region, …) and use those
  terms. `ARCHITECTURE.md` is the implementation contract — the **IPC seam**
  (`src/lib/ipc/backend.ts` + `tauri.ts` / `fake.ts` / `http.ts`) is central: every
  write method already exists on the `Backend` interface; the web just rejects them.
- **Key existing pieces:** `crates/sunstone-server/src/main.rs` (read-only axum),
  `src/hooks.server.ts` (`/api` proxy → axum), `src/lib/web/*` (viewer UI),
  `svelte.config.js` (`SUNSTONE_TARGET=web` → adapter-node + SSR). A git seam
  already exists (`fileHistory` / `fileAtRev` via the system `git` binary).
- **Skills:** use `/grilling` + `/domain-modeling` for decision tickets, `/prototype`
  for the editor-shell ticket, `/research` (subagent) for research tickets.
- Every change must keep the four green gates (see `CLAUDE.md`): `bun test src/lib`,
  `bun run check`, `cargo test`, `cargo check`.

## Decisions so far

<!-- one line per resolved ticket; zoom the link for detail -->

- [Research: auth approaches](issues/01-research-auth-approaches.md) — recommend GitHub
  OAuth via `@auth/sveltekit` (in-process cookie session), enforced in the `/api` hook,
  forwarding a trusted identity header to a **loopback-bound** axum; GitHub email+name =
  git author. Bearer token as CLI/bot secondary. Lucia is deprecated — avoid.
- [Research: git commit/push from server](issues/02-research-git-commit-push-from-server.md)
  — keep the **system `git` CLI** (already used in `sunstone-core/src/git.rs`); per-Save
  `git add`+commit with per-request `GIT_AUTHOR_*` / fixed committer, serialized behind
  one mutex (shared `index.lock`), push deferred (`GIT_TERMINAL_PROMPT=0` + deploy key);
  server **must** call `AppState::note_self_write` or its Save echoes over SSE.
- [Research: CodeMirror under SvelteKit SSR](issues/03-research-codemirror-under-sveltekit-ssr.md)
  — keep the SSR read view; mount the editor as a client-only island (`onMount` +
  **dynamic** `import('$lib/editor/cm')` into a `bind:this` host) so atomic-editor / CSS
  never enter the SSR graph. Don't drop SSR per-route.
- [Auth & git-identity model](issues/04-auth-and-git-identity-model.md) — **provider-agnostic
  OAuth/OIDC** via `@auth/sveltekit` (any provider giving name+email; Dex fronts LDAP/password).
  Reads open, **writes gated at the `/api` hook**, which mints a per-request ~60s **HS256 JWT**
  that **axum verifies itself** (axum self-defends; loopback now optional defense-in-depth).
  Commit **author = committer = OIDC name+email**. Authz = **trust the (operator-scoped)
  provider**, no app allowlist. CSRF via SvelteKit Origin check + `SameSite`/`HttpOnly` cookie
  + Auth.js `skipCSRFCheck`.
- [Git persistence & commit model](issues/05-git-persistence-and-commit-model.md) —
  **one Concept = one commit**, templated per-op messages (`edit/create/rename/move/delete
  <path> via web`). Text edits buffer until Save; **Tree CRUD commits immediately** (rewrites
  folded in). Structural op requires a **clean active buffer** — if dirty, a **confirm dialog**
  flush-commits it first (2 commits), **cancel aborts both**; editor holds **≤1 dirty buffer**.
  System `git` CLI extending `git.rs`; **author=committer=OIDC identity** via `GIT_*` env
  (overrides ticket 02's fixed committer); `note_self_write` on every written path. **One global
  write lock** wraps the whole write→rewrite→add→commit critical section; conflicts are
  last-write-wins (SSE warn/reload is separate). **Push/pull out of scope** (deployment-level).
- [Web editor shell](issues/06-web-editor-shell.md) — keep `WebViewer`'s SSR read chrome;
  add a **viewer-default + Edit toggle** (Edit shown to authed users only, swaps the CENTER
  article for the editor in place, Done/Save returns to rendered view). Mount the existing
  desktop **`Tile.svelte`** editor as a **client-only dynamic-`import()` island** — the island
  (`WebEditorIsland`) wraps the *whole* `Tile` (it statically imports CM/atomic-editor), keeping
  it out of the SSR graph (ticket 03). Not full `App.svelte`, not a from-scratch shell. Reuse is
  real but needs scaffolding: `Tile` couples to the `workspace` model + `focus`/`index`/`session`/
  `suggestions`/`theme`/`treeActions` stores, so the island constructs a **single-Tile** workspace
  state + stubs desktop-only affordances (region/tile-split). `cm.ts` drives unchanged, only the
  `http` backend swapped behind the seam. One Concept at a time (matches ≤1 dirty buffer).

## Not yet specified

<!-- in-scope fog; graduates into tickets as the foundational decisions resolve -->

- **`http.ts` write implementation** — mirror the resolved server write routes on the
  seam (drop the `READ_ONLY` rejections). Shape fixed by *Server write-route surface*.
- **Tree CRUD + link/anchor rewrite over HTTP** — create/rename/move/delete and the
  `rename`/`rewriteAnchors` link-rewrite machinery, faithfully server-side with
  commits. Depends on the write-route surface + git model.
- **Concurrency UX** — stale-buffer detection, SSE self-write suppression (the server
  now writes, so it must suppress its own echo like the desktop watcher does), and the
  last-write-wins warn/reload flow. Depends on the write routes + editor shell.
- **Deployment / ops** — self-hosted always-on server, Bundle-as-git-repo assumptions,
  env/config, how the Node SSR process and the axum server are run together. Depends on
  the git model.
- **Web write test strategy** — how Playwright exercises writing against the fake/http
  backend and how the fake backend models commits.
- **`/api` proxy body/identity forwarding** — the `hooks.server.ts` proxy forwards no
  cookie/body/auth and only GET-shaped reads today; write routes need it to forward POST
  bodies **and mint+attach the HS256 JWT** (per ticket 04). Auth model now decided; the
  concrete forwarding shape folds into *Server write-route surface* (ticket 07). (axum
  `0.0.0.0`→loopback is now optional defense-in-depth, not required — axum verifies the JWT.)

## Out of scope

<!-- ruled beyond the destination; never graduates unless the destination is redrawn -->

- **Real 3-way merge / CRDT collaborative editing** — explicitly excluded; concurrency
  is last-write-wins only.
- **Realtime multi-cursor / presence** beyond the last-write-wins refresh.
- **Per-user roles / fine-grained permissions** — all authenticated users can edit
  everything (few known users).
- **Multi-Bundle / Bundle switching on the web** — the server serves one fixed Bundle.
- **Offline / PWA editing.**
- **Remote push / pull from the server** ([ticket 05](issues/05-git-persistence-and-commit-model.md))
  — the server commits **locally only**; syncing the Bundle repo to a remote (backup, replication)
  is a deployment-level concern, not part of the web write path. Returns as a fresh effort if
  in-API push is ever needed.
- **CLI/bot web write path** ([ticket 04](issues/04-auth-and-git-identity-model.md) §8) —
  automation clones the git repo and commits/pushes via normal git, so the web write API
  needs no machine credential; axum accepts only the hook-minted JWT. Returns as a fresh
  effort if a bot ever needs the API.
