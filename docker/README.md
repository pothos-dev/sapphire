# Deploying Sunstone Web

Sunstone Web is the server-rendered, read-only viewer for an OKF Bundle. It ships
as a **single Docker image** that runs two processes side by side:

- **`sunstone-server`** — the read-only Rust API (axum over `sunstone-core`),
  serving `/api/*` (tree, concept, render, search, backlinks, tags, SSE events)
  over the mounted Bundle. It **only reads** the Bundle; there is no write path.
- **`node build`** — the SvelteKit **adapter-node** SSR server. It renders pages,
  hydrates in the browser, and proxies `/api/*` to the Rust API (see
  `src/hooks.server.ts`). This is the single public origin.

> This is separate from the **desktop** release flow (the `/deploy` skill, which
> tags a version and lets GitHub Actions build the Tauri installers). Deploying
> the web viewer does not touch versions, tags, or the desktop artifacts.

The Dockerfile and this guide live at the repo root and in this `docker/` folder;
the compose files (`docker-compose*.yml`) sit at the repo root. Commands below run
**from the repo root** unless noted.

> ## ⚠️ No authentication — internal networks only
>
> The container has **no authentication or authorization** of any kind. Anyone
> who can reach the published port can read the entire Bundle. Until an auth phase
> lands you **must**:
>
> - keep it on a trusted internal network / VPN, or behind a private reverse proxy
>   that enforces access control, and
> - **never** expose the published port directly to the public internet.
>
> The mount is read-only, so exposure is a confidentiality risk (the Bundle can be
> read), not an integrity one (it cannot be modified through the app).

## Quick start (docker compose)

From the repo root:

```bash
# Serve the Bundle at /srv/okf/my-bundle on host port 8080:
SUNSTONE_BUNDLE_HOST=/srv/okf/my-bundle SUNSTONE_WEB_PORT=8080 \
  docker compose up --build -d

# Then open http://<internal-host>:8080/
```

Two knobs, both with sane defaults:

| Variable               | Default      | Meaning                                     |
| ---------------------- | ------------ | ------------------------------------------- |
| `SUNSTONE_BUNDLE_HOST` | `./examples` | Host path of the Bundle directory to serve. |
| `SUNSTONE_WEB_PORT`    | `3000`       | Host port the web viewer is published on.   |

The Bundle is bind-mounted **read-only** (`:ro`) into the container at `/bundle`,
and `SUNSTONE_BUNDLE=/bundle` points the server at it. The container cannot write
to your Bundle even if it tried.

Stop it with `docker compose down`.

## What runs inside the container

| Process         | Port (in container) | Env                                                |
| --------------- | ------------------- | -------------------------------------------------- |
| SSR web (node)  | `3000` (published)  | `HOST=0.0.0.0`, `PORT=3000`                        |
| Rust API (axum) | `8787` (internal)   | `SUNSTONE_BUNDLE=/bundle`, `SUNSTONE_API_PORT=8787` |

The web process reaches the API over container loopback via
`SUNSTONE_API_INTERNAL=http://localhost:8787`. Only the web port is published;
the API port stays private to the container.

`docker/entrypoint.sh` is PID 1: it starts the API in the background, starts the
node server, forwards `SIGTERM`/`SIGINT` to both, and — via `wait -n` — exits the
whole container as soon as **either** process dies. `restart: unless-stopped`
(compose) then restarts the container, and `init: true` reaps zombies. So a crash
of either half brings the container down cleanly rather than leaving it
half-serving.

## Live reload & concurrent viewers

The API exposes `/api/events` as a Server-Sent Events stream fed by the
filesystem watcher; the SSR proxy streams it through un-buffered. Any number of
browsers can view the same container concurrently, and an external edit to the
Bundle on the host is pushed to every connected viewer.

The watcher attaches to the Bundle root's inode(s) at startup, so live reload
only fires when edits are written **in place under a stable path**. This matters
when a git sync feeds the folder: a tool that swaps a symlink to a fresh
directory per update (e.g. git-sync) will **not** live-reload. The
[git-backed deployment](#serving-a-git-backed-wiki) section below covers the
sync patterns and the tested per-approach verdict.

## Building the image directly (without compose)

```bash
docker build -t sunstone-web:latest .
docker run --rm -p 3000:3000 \
  -v /srv/okf/my-bundle:/bundle:ro \
  -e SUNSTONE_BUNDLE=/bundle \
  sunstone-web:latest
```

## Image layout (multi-stage build)

1. **`rust-build`** (`rust:1-bookworm`) — `cargo build --release -p sunstone-server`.
   `src-tauri` is a workspace member, so its manifest is present, but it is
   stubbed and never compiled (no Tauri deps are pulled).
2. **`web-build`** (`oven/bun:1`) — `bun install` then
   `SUNSTONE_TARGET=web bun run build` (adapter-node → `build/`), then a pruned
   production `node_modules` for the externalized runtime deps (e.g. `yaml`).
3. **`runtime`** (`node:22-bookworm-slim`) — the `sunstone-server` binary, the
   `build/` output, the production `node_modules`, and the entrypoint. `bookworm`
   on both build and runtime keeps glibc compatible.

---

# Serving a git-backed wiki

The base deployment above serves any folder. To back the served Bundle with a git
repo — your wiki lives in a git repo, a small piece of infrastructure keeps a
folder in sync with it, and Sunstone Web mounts that folder **read-only** and
serves it — read on.

Sunstone itself is unchanged: it only ever **mounts a folder read-only**. All
git/content fetching lives _outside_ the image, in a sidecar or a host-side hook.

## How it fits together

```
   author            infra (outside Sunstone)                  Sunstone Web
  ┌───────┐  git   ┌───────────────────────┐  shared folder  ┌──────────────┐
  │ push  │ ─────▶ │ sidecar / bare-repo    │ ──────────────▶ │ watcher →    │
  │ commit│        │ hook writes work-tree  │      (:ro)      │ /api/events  │
  └───────┘        └───────────────────────┘                 │ → browsers   │
                                                              └──────────────┘
```

Sunstone's Rust API runs a recursive `notify`/inotify watcher over the Bundle
root ([`../crates/sunstone-core/src/watcher.rs`](../crates/sunstone-core/src/watcher.rs))
and fans every change out over the `/api/events` SSE stream
([`../crates/sunstone-server/src/main.rs`](../crates/sunstone-server/src/main.rs)).
**Whether an external content update actually reaches a browser depends entirely
on how the sync writes the folder** — see the verdict below.

## The live-reload verdict (tested)

I stood up each approach against a local git repo and watched `/api/events`
while pushing commits (Docker 29, git-sync v4.4.2, `sunstone-web:latest`).

| Approach | Live reload? | Notes |
| --- | --- | --- |
| **Bare repo + `post-receive` hook** | ✅ **yes, instant** | Recommended. Push-triggered `checkout -f` into a fixed work-tree; git metadata kept out of the served tree, so SSE carries only real content events. |
| **git-checkout sidecar (polling)** | ✅ **yes, on next poll** | Recommended when you can't run a hook. Same in-place `checkout -f` mechanism, polled. |
| **git-sync sidecar** | ❌ **no** — and worse | Content updates do **not** reach browsers, and the server **404s** after the first sync until restarted. Use only if a manual restart per update is acceptable. |
| in-place `git pull` in the served dir | ⚠️ works but noisy | The `.git` dir sits _inside_ the watched tree, so every fetch floods SSE with `.git/…` events. Prefer the separate-git-dir approaches above. |

### Why git-sync does not live-reload (observed)

git-sync (v4) updates atomically: it writes each commit into a **new** worktree
directory and repoints a **symlink** at it, then garbage-collects the old
worktree.

```
/content/bundle -> .worktrees/<sha>     # symlink, repointed on every sync
/content/.worktrees/<sha>/…             # a whole new dir per commit
```

Sunstone canonicalises `SUNSTONE_BUNDLE` **once at startup**
(`resolve_bundle_root`), so the watcher attaches to that _one_ worktree's inode.
When git-sync swaps the symlink:

- the watcher never sees the new worktree (it's a different directory), so no
  update reaches browsers; and
- once git-sync GC's the old worktree, the path the server is pinned to is
  **deleted** — every `/api/*` request then returns a 404/IO error.

Observed directly: after a push, the only SSE traffic was spurious `removed`
events for the _old_ files, and `/api/concept` began returning
`No such file or directory`. A `docker compose restart sunstone-web` recovers it
(it re-canonicalises to the current worktree and serves the latest commit) — so
git-sync is a "restart per update" model, not live reload.

The in-place approaches write files under a **stable** path, so inotify fires and
`/api/events` emits real `created`/`modified`/`removed` events. Observed: pushing
a commit produced exactly `removed`/`created`/`modified` for the changed files,
and the API served the new content with no restart.

## Recommended: bare repo + `post-receive` hook (push-instant, no sidecar)

Push to a bare repo on the host; a hook checks the ref out **in place** into the
folder Sunstone serves. Instant, no polling, no extra container. The git metadata
stays in the bare repo, so the served folder holds only content files (clean SSE).

The ready-to-install hook is [`post-receive.example`](post-receive.example):

```bash
# On the host that will serve the wiki:
git init --bare /srv/wiki.git
mkdir -p /srv/wiki
install -m 0755 docker/post-receive.example /srv/wiki.git/hooks/post-receive
#   (edit DEPLOY_REF / WORK_TREE in the hook if your branch or path differ)

# Point the base compose at the work-tree (folder mount, read-only):
SUNSTONE_BUNDLE_HOST=/srv/wiki SUNSTONE_WEB_PORT=8080 docker compose up -d

# From anywhere with SSH to the host:
git remote add wiki ssh://user@host/srv/wiki.git
git push wiki main       # each push updates the live viewer instantly
```

The hook runs `git --git-dir=/srv/wiki.git --work-tree=/srv/wiki checkout -f`,
which rewrites only changed files under `/srv/wiki` — the watcher fires and every
open browser updates without reloading.

## Recommended sidecar: git-checkout (polling, live reload)

When you can't push to the host (e.g. the source is a hosted repo you can only
poll), use the polling sidecar in
[`../docker-compose.git-checkout.yml`](../docker-compose.git-checkout.yml). It
keeps a mirror repo in a **private** volume and checks the work-tree out into a
**shared** volume with `--git-dir` pointed at the private one — so, like the hook,
the served folder has no `.git` and SSE stays clean.

```bash
SUNSTONE_GIT_REPO=https://github.com/you/wiki \
SUNSTONE_GIT_REF=main \
SUNSTONE_GIT_PERIOD=30 \
SUNSTONE_WEB_PORT=8080 \
  docker compose -f docker-compose.git-checkout.yml up -d
```

Services and volumes:

| Service | Role | Volumes |
| --- | --- | --- |
| `git-checkout` | mirrors + checks out the repo every `SUNSTONE_GIT_PERIOD`s | `gitdir` (private, git metadata), `content` (shared work-tree) |
| `sunstone-web` | serves `content` read-only; `SUNSTONE_BUNDLE=/content` | `content:/content:ro` |

Content shows up within one poll interval and is pushed straight to browsers.

## Alternative sidecar: git-sync (no live reload)

[`../docker-compose.gitsync.yml`](../docker-compose.gitsync.yml) wires the
standard Kubernetes [git-sync](https://github.com/kubernetes/git-sync) as a
sidecar. It is the most "standard" option, **but** — per the verdict above — it
does not live-reload and the server 404s after the first sync until restarted:

```bash
SUNSTONE_GIT_REPO=https://github.com/you/wiki \
SUNSTONE_GIT_REF=main \
SUNSTONE_GIT_PERIOD=30s \
SUNSTONE_WEB_PORT=8080 \
  docker compose -f docker-compose.gitsync.yml up -d

# After content changes, pick them up with:
docker compose -f docker-compose.gitsync.yml restart sunstone-web
```

Only choose git-sync if a manual restart per update is acceptable; otherwise use
the git-checkout sidecar above, which uses the same polling model but reloads
live.

> A fresh named volume is root-owned and git-sync's default uid (65533) cannot
> write it, so the compose runs git-sync as `user: "0:0"`. It only writes the
> shared volume; Sunstone mounts it `:ro`.

## Alternative: webhook-triggered pull

For push-instant updates _without_ SSH access to the serving host, run a webhook
receiver (e.g. [`adnanh/webhook`](https://github.com/adnanh/webhook)) as a sidecar
that, on a GitHub/GitLab push webhook, runs the **same** `checkout -f` into the
shared work-tree as the hook above (git-dir kept out of the served tree). This
reloads live like the recommended approaches.

The trade-off is reachability: the forge must be able to reach the receiver, so
you need an inbound URL (reverse proxy / ingress) and should verify the webhook
secret. If your forge can't reach the container, prefer the polling git-checkout
sidecar.

## Environment & volume reference

Sidecar knobs (both `docker-compose.git-checkout.yml` and `docker-compose.gitsync.yml`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUNSTONE_GIT_REPO` | — (required) | Git URL of the wiki repo to sync. |
| `SUNSTONE_GIT_REF` | `main` | Branch / tag / commit to serve. |
| `SUNSTONE_GIT_PERIOD` | `30` (checkout) / `30s` (git-sync) | Poll interval. |
| `SUNSTONE_WEB_PORT` | `3000` | Host port the viewer is published on. |

Sunstone container env:

| Variable | Meaning |
| --- | --- |
| `SUNSTONE_BUNDLE` | Bundle root inside the container. Point at a **stable directory** (`/content`), not a swapped symlink. |
| `HOST` / `PORT` | SSR web bind (`0.0.0.0:3000`). |
| `SUNSTONE_API_PORT` / `SUNSTONE_API_INTERNAL` | Internal Rust API port + URL. |

Shared content is passed as a **named volume** between the sidecar (read-write)
and Sunstone (`:ro`), or as a **host folder** bind-mount for the post-receive-hook
approach (`SUNSTONE_BUNDLE_HOST`).

---

# Publishing & installing from Docker Hub

The guides above build the image locally. To install Sunstone Web on a remote host
**without a repo checkout or build context**, push the image to Docker Hub once and
pull it there (see [running the published image](#running-the-published-image-remote-host)
below).

## One-time setup (maintainer only)

Pushing requires **your** Docker Hub credentials — nobody else can push under
your namespace on your behalf. Do this once:

1. Create a [Docker Hub](https://hub.docker.com/) account and, under **Account
   Settings → Personal access tokens**, create an access token with
   **Read & Write** scope.
2. In this GitHub repo, under **Settings → Secrets and variables → Actions**, set:
   - a **variable** `DOCKERHUB_USERNAME` — your Docker Hub namespace (used to
     derive the image name `<namespace>/sunstone-web`; nothing is hardcoded), and
   - a **secret** `DOCKERHUB_TOKEN` — the access token from step 1.

The image name is always `${DOCKERHUB_USERNAME}/sunstone-web`.

## Automatic path: tag a release

Tagging a release (`vX.Y.Z`, the same tag the desktop
[release flow](../.github/workflows/release.yml) reacts to) triggers
[`publish-web-image.yml`](../.github/workflows/publish-web-image.yml). It builds
a **multi-arch** (`linux/amd64,linux/arm64`) image and pushes two tags:
`:<version>` (e.g. `0.14.0`, the tag with the leading `v` stripped) and
`:latest`. The job is standalone — it does not wait on the Tauri installer build.

You can also run it on demand from the **Actions** tab
(**Publish Web Image → Run workflow**), optionally overriding the tag (defaults
to `latest`).

## Manual path: build & push from your machine

If you'd rather push by hand (or don't use GitHub Actions), build multi-arch with
buildx and push in one step. Log in first, then:

```bash
docker login                     # authenticate to Docker Hub

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t <your-user>/sunstone-web:<version> \
  -t <your-user>/sunstone-web:latest \
  --push .
```

`--platform linux/amd64,linux/arm64` matters because the image is built for a
specific CPU architecture: if your machine is `arm64` (e.g. Apple Silicon) but
the remote is `amd64` (or vice versa), a single-arch image won't run there.
Building both and pushing a manifest list lets the remote pull the arch it needs.
buildx must push a multi-arch build straight to the registry — it can't `--load`
a multi-arch result into the local Docker daemon.

## Running the published image (remote host)

On the remote, use [`../docker-compose.remote.yml`](../docker-compose.remote.yml),
which runs the published image (`image:` instead of `build:`) with the same
read-only Bundle mount, published web port, and no-auth/internal-only posture as
the base compose:

```bash
DOCKERHUB_USERNAME=your-user SUNSTONE_TAG=0.14.0 \
SUNSTONE_BUNDLE_HOST=/srv/okf/my-bundle SUNSTONE_WEB_PORT=8080 \
  docker compose -f docker-compose.remote.yml pull && \
  docker compose -f docker-compose.remote.yml up -d
```

`SUNSTONE_TAG` defaults to `latest`. To keep a git-backed Bundle in sync on the
remote too, combine it with a sync sidecar: run the `git-checkout` service from
[`../docker-compose.git-checkout.yml`](../docker-compose.git-checkout.yml)
alongside this file (`-f docker-compose.remote.yml -f docker-compose.git-checkout.yml`)
and point `SUNSTONE_BUNDLE` at the shared `/content` volume — the remote image
replaces the locally-built one while the sidecar handles the content.
