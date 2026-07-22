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

- **Domain:** read `CONTEXT.md` (Bundle, Concept, Wikilink, Region, …) and use those
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
- **Viewer↔editor gating in the web UI** — anonymous = read-only viewer vs
  authenticated = editor; how the mode is chosen and surfaced. Depends on auth + shell.
- **Deployment / ops** — self-hosted always-on server, Bundle-as-git-repo assumptions,
  env/config, how the Node SSR process and the axum server are run together. Depends on
  the git model.
- **Web write test strategy** — how Playwright exercises writing against the fake/http
  backend and how the fake backend models commits.

## Out of scope

<!-- ruled beyond the destination; never graduates unless the destination is redrawn -->

- **Real 3-way merge / CRDT collaborative editing** — explicitly excluded; concurrency
  is last-write-wins only.
- **Realtime multi-cursor / presence** beyond the last-write-wins refresh.
- **Per-user roles / fine-grained permissions** — all authenticated users can edit
  everything (few known users).
- **Multi-Bundle / Bundle switching on the web** — the server serves one fixed Bundle.
- **Offline / PWA editing.**
