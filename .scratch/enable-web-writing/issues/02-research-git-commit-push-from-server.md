# 02 — Research: git commit/push from the Rust server

Type: research
Status: claimed
Blocked by: None

## Question

The Bundle on the server is (assumed) a git repo; a web "Save" must commit (and
possibly push). What is the right way for `sunstone-server` to perform commits?

Investigate:

- **What the repo already uses.** The `Backend` git seam (`fileHistory` / `fileAtRev`)
  shells out to the **system `git` binary**. Confirm this (`src-tauri` / `sunstone-core`
  git code) and weigh continuing with the CLI vs a library (`git2` / `gix`): commit,
  set author/committer per request, and optionally push.
- **Authorship per request** — how to commit as a specific user (author name/email
  from the auth identity) while the committer is the server. `GIT_AUTHOR_*` env vs
  `git -c user.name=…`. This is the seam to the auth ticket.
- **Push policy mechanics** — if pushing, credential handling for a non-interactive
  server (deploy key / token), failure modes, and whether push should be synchronous
  with the Save or deferred.
- **Concurrency** — two near-simultaneous commits to one working tree/repo: index
  locking, and whether commits must be serialized server-side.
- **Interaction with the filesystem watcher** — the server's own writes+commits will
  fire `notify` events; the desktop suppresses self-writes. What must the server do so
  its own Save doesn't echo back over SSE as an external change?

Write findings to `.scratch/enable-web-writing/research/02-git-commit-push.md` and
link them here. Feeds the *Git persistence & commit model* decision.
