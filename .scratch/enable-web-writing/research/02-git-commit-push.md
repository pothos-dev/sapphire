# 02 — Git commit/push from `sunstone-server`

Research for the *Git persistence & commit model* decision. Sources: the repo's
own Rust (primary), plus git-scm.com docs for the CLI facts. Web access WAS
available; CLI/env facts below are verified against git-scm.com. Anything not
verified is labeled **[verify]**.

## TL;DR

Keep shelling out to the **system `git` binary** via `std::process::Command`
(the repo already does this and takes NO git-library dependency). For a web
Save: `git add <path>` then `git commit` with a **per-request author** and a
**fixed server committer**, injected via `GIT_AUTHOR_NAME/EMAIL` +
`GIT_COMMITTER_NAME/EMAIL` env vars on the child process. **Serialize all
mutating git ops behind one server-side mutex** (one working tree = one shared
`.git/index.lock`). **Defer push** (fire-and-forget after commit, or a
background flush) with non-interactive credentials (`GIT_TERMINAL_PROMPT=0` +
deploy key via `GIT_SSH_COMMAND`, or a token in the remote URL). Replicate the
desktop's **self-write suppression**: call `AppState::note_self_write(resolved)`
for every path the server writes/commits so the watcher does not echo the Save
back over SSE.

## 1. What the repo already uses — CLI, confirmed

`crates/sunstone-core/src/git.rs` is the entire git seam. Its module doc says it
outright: *"backed by the system `git` binary via `std::process::Command` (NO
git-library dependency)"*. Confirmed by:

- `run_git(root, args)` = `Command::new("git").current_dir(root).args(args).output().ok()`
  (git.rs ~L187). Working dir is the Bundle root, so pathspecs and
  `<rev>:./<path>` resolve relative to the Bundle even when it is a subdir of a
  larger repo (git.rs L129-133, L16-19).
- Only two read ops today: `file_history` (`git log --follow --format=… --date=iso-strict -- <path>`)
  and `file_at_rev` (`git show <rev>:./<path>`). Both are surfaced to the
  desktop through Tauri commands in `src-tauri/src/lib.rs` (L250, L266) and are
  read-only. **There is no write/commit/push code anywhere yet.**
- No `git2`/`gix`/`libgit2` in the dependency tree — the repo deliberately has
  zero git-library deps. `Cargo` has only the CLI approach.
- Cargo/test convention: failure modes are returned as *values*
  (`NotARepo`/`Untracked`/`NoHistory`/`GitMissing`), never panics, so the UI can
  degrade. New write ops should follow the same "distinguishable value" shape.

Note the current dev default: `sunstone-server` serves `examples/`, which is a
**subdirectory of the main Sunstone repo** (no nested `.git`). So a real deploy
must point `SUNSTONE_BUNDLE` at a directory that is (or is inside) its own repo;
`git rev-parse --is-inside-work-tree` / the existing `NotARepo` detection tells
the server whether committing is even possible.

### CLI vs `git2`/`gix` — recommendation: stay on the CLI

| | System `git` CLI (current) | `git2` (libgit2) | `gix` (gitoxide) |
|---|---|---|---|
| Matches repo today | Yes — zero new deps, same seam | No — new C-linked dep | No — new dep |
| Author/committer split | Trivial via env or `-c` | `Signature` API | `Signature` API |
| Push + creds | Reuses user's git config, credential helpers, SSH agent, deploy keys "for free" | Must wire `RemoteCallbacks`/`credentials` by hand (libgit2 credential callbacks are fiddly) | Push support historically incomplete **[verify current gix push maturity]** |
| Build/portability | Needs `git` on PATH at runtime (already a hard assumption of the seam) | Bundles libgit2 (heavier build, C toolchain) | Pure Rust, no C |
| `.gitattributes`/hooks/filters/LFS | Honored automatically | Partial | Partial |
| Perf | Process spawn per op (fine at human Save cadence) | In-process (faster, irrelevant here) | In-process |

**Verdict: keep the CLI.** Save happens at human cadence (seconds apart), so the
process-spawn cost is irrelevant, and the CLI gets correct credential handling,
hooks, and `.gitattributes` behavior for free — which is exactly the hard part
of a server that pushes. Adopting `git2` only pays off if you need in-process
credential callbacks or to avoid a PATH dependency; neither applies. Reuse and
extend the existing `run_git` helper (lift it into a shared spot both hosts can
call, or add a `git::commit_path(...)`/`git::push(...)` alongside the read ops).

## 2. Authorship per request — author = user, committer = server

Git models author and committer as **separate identities** (verified against
git-scm.com/docs/git-commit). Precedence for each: `GIT_*` env → `author.*`/
`committer.*` config → `user.*` config → `EMAIL` → system user@host.

Two clean ways to set author ≠ committer per request:

1. **Env vars on the child process (recommended for a server).** Set on the
   `Command` for that one commit, so nothing global is mutated and concurrent
   requests can't leak identity into each other:
   ```
   GIT_AUTHOR_NAME    = <auth user's display name>
   GIT_AUTHOR_EMAIL   = <auth user's email>
   GIT_COMMITTER_NAME = "Sunstone Server"      # fixed server identity
   GIT_COMMITTER_EMAIL= "server@…"             # fixed server identity
   ```
   `Command::env(...)` scopes these to the single spawned process — the correct
   isolation model for a multi-request server. This is the seam to the auth
   ticket: the auth identity fills `GIT_AUTHOR_*`.
2. **`git -c user.name=… -c user.email=…` +`--author=`.** `--author="Name <email>"`
   sets author only; committer still comes from config/env. Works, but you need
   both the `--author` flag *and* committer `-c` overrides, so it is clumsier
   than just setting the four env vars. (Beware: an `--author` string that isn't
   in `Name <email>` form is treated as a *search pattern* over existing commits
   — a footgun. Env vars avoid this entirely.)

**Recommendation:** env-var injection (#1). Optionally also set `GIT_AUTHOR_DATE`
to the request time for determinism. Sanitize/validate the auth-derived name and
email (reject newlines / `<>` that could break the commit header) before
injecting — even though env avoids shell-quoting, a crafted name could still
malform the commit object. **[verify]** exact header-injection surface, but
validating out control chars is cheap and safe.

## 3. Push policy mechanics (non-interactive server)

**Credentials — pick one, keep it non-interactive:**
- **SSH deploy key (recommended):** `GIT_SSH_COMMAND="ssh -i /path/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"` on the push child. A
  per-repo, write-scoped deploy key is the least-privilege choice.
- **HTTPS token:** a credential helper or token embedded in the remote URL
  (`https://x-access-token:<token>@host/…`). Keep the token out of logs and out
  of the committed remote config; prefer a credential helper or an
  `askpass`/env-fed helper.
- **Always set `GIT_TERMINAL_PROMPT=0`** on any push/fetch child so a missing or
  bad credential fails fast with a non-zero exit instead of hanging the request
  waiting on a TTY that a server does not have. (Verified: git-scm.com — this is
  the standard automation switch.)

**Sync vs deferred — defer.** Committing is local and fast; pushing hits the
network and can be slow or fail (offline, auth expiry, **non-fast-forward
rejection** if the remote moved). Do NOT block the user's Save HTTP response on a
push. Model:
- Commit synchronously (Save is only "durable" once committed locally) → return
  success to the browser.
- Push asynchronously: a background task / flush queue that pushes after commit,
  with retry. Surface push state separately (e.g. an SSE "sync status" or a
  header) rather than failing the Save.

**Failure modes to handle:** no remote configured; auth failure; network down;
**rejected non-fast-forward** (remote has commits the server lacks — needs a
pull/rebase/merge policy, which a single-writer server can often avoid but must
still detect); large-file / hook rejection on the remote. Each should be a
distinguishable value/log, never a panic, matching the git.rs convention. For a
first cut, "commit locally always, push best-effort with retry + visible sync
status" is the safe default; **[decision]** whether the server ever auto-pulls
to resolve non-fast-forward, or just alarms and stops pushing.

## 4. Concurrency — one working tree, serialize writes

**One Bundle = one working tree = one shared `.git/index.lock`.** Git uses a
single-writer lock model: every mutating command (`add`, `commit`, ref updates)
takes `.git/index.lock`; a second concurrent writer gets
`fatal: Unable to create '.git/index.lock': File exists`. (Verified via git
tooling reports; this is the well-known root cause.) The read ops today
(`log`/`show`) don't take the lock, so today's server is safe — but the moment
Save writes+commits, two near-simultaneous Saves race.

Worse than the visible lock error is the **silent index race**: staging in a
shared index has one slot per path; interleaved `add`/`commit` from two requests
can lose or cross-contaminate staged changes. So this is not just "retry the
lock" — the whole write→add→commit sequence must be atomic per request.

**Recommendation:** serialize the entire write+stage+commit sequence behind a
single server-side async mutex (e.g. a `tokio::sync::Mutex` held for the
duration of one Save's git work) so only one commit touches the tree at a time.
Saves are human-cadence, so a global commit lock has negligible latency cost.
Additionally:
- Commit specific pathspecs (`git add <path> && git commit -- <path>`, or
  `git commit -o <path>`) rather than `git add -A`, so a Save only ever commits
  the file(s) it wrote — defense in depth against picking up an unrelated
  concurrent write.
- Add **retry-with-backoff** (a few tries, ~200ms → 800ms) around lock failures
  as a belt-and-suspenders guard against stray locks (e.g. a desktop instance or
  a manual git command on the same repo).
- Consider clearing a **stale** `index.lock` only if clearly orphaned (age
  threshold), but prefer serialization + retry over auto-deleting locks.

## 5. Interaction with the filesystem watcher — replicate self-write suppression

This is the subtle one and the repo already has the mechanism; the server just
isn't using it yet.

**How the desktop suppresses self-writes (confirmed):**
- `AppState` (`crates/sunstone-core/src/app_state.rs`) keeps a
  `self_writes: Mutex<HashMap<PathBuf, Instant>>` and a `SELF_WRITE_WINDOW`
  (1500 ms). `note_self_write(abs_path)` records a write;
  `is_recent_self_write(path)` returns true once within the window then
  **consumes** the entry (so a later genuine external edit still reloads) and
  prunes stale entries.
- The desktop write command does exactly this: `src-tauri/src/lib.rs` L90-93 —
  `write_concept` calls `bundle::write_concept(...)` (which returns the resolved
  absolute path) then `state.note_self_write(resolved)`.
- The watcher (`crates/sunstone-core/src/watcher.rs`, `handle_event`) checks
  `state.is_recent_self_write(abs)` and, on a match, **still updates the index**
  (on-disk truth) but **skips pushing the change to the sink** (L92-100). So the
  index stays correct while the frontend/SSE echo is suppressed.

**The server's current stance is wrong for writing.** `sunstone-server/src/main.rs`
L26-28 / L80-81 explicitly assumes *"the web server never writes… nothing to
suppress — every change is a genuine external edit."* Its watcher sink
broadcasts **every** `FileChange` over the `/api/events` SSE channel. As soon as
Save writes a file, that write will fire a notify event and echo back to every
connected browser as an "external change" — causing reload loops / cursor jumps,
the exact problem the desktop already solved.

**What the server must replicate:** before/when it writes and commits a Concept,
call `state.app.note_self_write(resolved_abs_path)` for each path it touches —
using the **same shared `AppState`** the watcher holds (it already does:
`watcher::start(root, app_state.clone(), …)` in main.rs L85). Then the existing
`handle_event` suppression path applies unchanged: the index updates, the SSE
echo is swallowed for the saving client and everyone else. Caveats:
- The suppression is **single-shot per path** and consumed on first match, and
  windowed at 1500 ms — a single `fs::write` produces one (sometimes coalesced)
  notify event, which is what the desktop relies on. **[verify]** that a
  server-side write + `git add`/`commit` doesn't generate *extra* mutations to
  the working-tree copy of the file (commit itself doesn't rewrite the working
  file, so it shouldn't). If `git` operations touch the file again (e.g. CRLF/
  clean filters via `.gitattributes` rewriting on checkout), a second event
  could slip past the consumed entry — worth testing on a repo with filters.
- Note the desktop model suppresses the **frontend echo to the writer**, but the
  server's SSE fans out to *all* browsers. For a save the writer's own client
  should update optimistically and other clients arguably *should* see the
  change. So the server may want a **finer model than the desktop's**: suppress
  the echo only to the originating session, but still broadcast to others (i.e.
  self-write is per-connection, not global). The desktop's global suppression is
  fine for a single-user shell; multi-client web likely wants the change
  delivered to *other* viewers. **[decision]** for the write-model ticket:
  broadcast-to-others vs suppress-globally. At minimum, replicate
  `note_self_write` so the current all-clients echo storm doesn't happen; refine
  toward per-session if concurrent viewers matter.

## Concrete shopping list for the implementation ticket

- Extend `sunstone-core::git` with `commit_path(root, rel_path, author, committer, msg)`
  and `push(root, opts)`, reusing/generalizing `run_git` (add `.env(...)` and an
  `.envs` variant); keep the value-not-panic error convention.
- `Command` env per commit: `GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL`,
  optional `GIT_AUTHOR_DATE`; validate author name/email for control chars.
- Push child: `GIT_TERMINAL_PROMPT=0` + `GIT_SSH_COMMAND` (deploy key) or token
  helper; run it off the request path (background flush + retry).
- One `tokio::sync::Mutex` around the write→add→commit sequence; scoped
  pathspec commits; lock-retry with backoff.
- On the server write path, call `AppState::note_self_write(resolved)` for each
  written path (shared AppState already wired into the watcher). Decide
  broadcast-to-others vs global suppression for multi-client SSE.
- Precondition check: `git rev-parse --is-inside-work-tree` (reuse existing
  `NotARepo` detection) — the dev default `examples/` is not its own repo.

## Sources

- Repo code (primary): `crates/sunstone-core/src/git.rs`,
  `crates/sunstone-core/src/app_state.rs`, `crates/sunstone-core/src/watcher.rs`,
  `crates/sunstone-core/src/bundle.rs`, `crates/sunstone-server/src/main.rs`,
  `src-tauri/src/lib.rs`.
- git-scm.com/docs/git-commit — author vs committer env vars, precedence,
  `--author` pattern footgun, `--date` formats.
- git-scm.com/docs/git-push + automation guidance — `GIT_TERMINAL_PROMPT=0`,
  `GIT_SSH_COMMAND` deploy keys, credential helpers.
- Git single-writer `index.lock` model / serialize-writes guidance (multiple
  agent-tooling writeups; well-established git mechanics) — **[verify]** exact
  reftable/backoff specifics if you rely on them.
