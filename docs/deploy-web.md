# Deploying Sapphire Web

Sapphire Web is the server-rendered, read-only viewer for an OKF Bundle. It ships
as a **single Docker image** that runs two processes side by side:

- **`sapphire-server`** — the read-only Rust API (axum over `sapphire-core`),
  serving `/api/*` (tree, concept, render, search, backlinks, tags, SSE events)
  over the mounted Bundle. It **only reads** the Bundle; there is no write path.
- **`node build`** — the SvelteKit **adapter-node** SSR server. It renders pages,
  hydrates in the browser, and proxies `/api/*` to the Rust API (see
  `src/hooks.server.ts`). This is the single public origin.

> This is separate from the **desktop** release flow (the `/deploy` skill, which
> tags a version and lets GitHub Actions build the Tauri installers). Deploying
> the web viewer does not touch versions, tags, or the desktop artifacts.

## ⚠️ No authentication — internal networks only

The container has **no authentication or authorization** of any kind. Anyone who
can reach the published port can read the entire Bundle. Until an auth phase
lands you **must**:

- keep it on a trusted internal network / VPN, or behind a private reverse proxy
  that enforces access control, and
- **never** expose the published port directly to the public internet.

The mount is read-only, so exposure is a confidentiality risk (the Bundle can be
read), not an integrity one (it cannot be modified through the app).

## Quick start (docker compose)

From the repo root:

```bash
# Serve the Bundle at /srv/okf/my-bundle on host port 8080:
SAPPHIRE_BUNDLE_HOST=/srv/okf/my-bundle SAPPHIRE_WEB_PORT=8080 \
  docker compose up --build -d

# Then open http://<internal-host>:8080/
```

Two knobs, both with sane defaults:

| Variable               | Default      | Meaning                                        |
| ---------------------- | ------------ | ---------------------------------------------- |
| `SAPPHIRE_BUNDLE_HOST` | `./examples` | Host path of the Bundle directory to serve.    |
| `SAPPHIRE_WEB_PORT`    | `3000`       | Host port the web viewer is published on.      |

The Bundle is bind-mounted **read-only** (`:ro`) into the container at `/bundle`,
and `SAPPHIRE_BUNDLE=/bundle` points the server at it. The container cannot write
to your Bundle even if it tried.

Stop it with `docker compose down`.

## What runs inside the container

| Process           | Port (in container) | Env                                                       |
| ----------------- | ------------------- | --------------------------------------------------------- |
| SSR web (node)    | `3000` (published)  | `HOST=0.0.0.0`, `PORT=3000`                               |
| Rust API (axum)   | `8787` (internal)   | `SAPPHIRE_BUNDLE=/bundle`, `SAPPHIRE_API_PORT=8787`       |

The web process reaches the API over container loopback via
`SAPPHIRE_API_INTERNAL=http://localhost:8787`. Only the web port is published;
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
directory per update (e.g. git-sync) will **not** live-reload. See
[`../docker/README.md`](../docker/README.md) for the git-backed deployment
patterns and the tested per-approach verdict.

## Serving a git-backed wiki

To back the served Bundle with a git repo (a sidecar or host-side hook keeps the
mounted folder in sync while Sapphire serves it read-only), see
**[`../docker/README.md`](../docker/README.md)**. It covers three sync approaches
— a `post-receive` hook and a git-checkout sidecar (both live-reload), and a
git-sync sidecar (does not) — with copy-paste compose files.

## Building the image directly (without compose)

```bash
docker build -t sapphire-web:latest .
docker run --rm -p 3000:3000 \
  -v /srv/okf/my-bundle:/bundle:ro \
  -e SAPPHIRE_BUNDLE=/bundle \
  sapphire-web:latest
```

## Publishing & installing from Docker Hub

To run Sapphire Web on a remote host **without a repo checkout or build context**,
publish the image to Docker Hub (a release tag pushes it automatically, or push
by hand) and pull it on the remote with
[`../docker-compose.remote.yml`](../docker-compose.remote.yml). The full setup —
the one-time credentials the maintainer must configure, the multi-arch build, and
the remote `pull` + `up` flow — lives in
**[`../docker/README.md`](../docker/README.md#publishing-to-docker-hub)**.

## Image layout (multi-stage build)

1. **`rust-build`** (`rust:1-bookworm`) — `cargo build --release -p sapphire-server`.
   `src-tauri` is a workspace member, so its manifest is present, but it is
   stubbed and never compiled (no Tauri deps are pulled).
2. **`web-build`** (`oven/bun:1`) — `bun install` then
   `SAPPHIRE_TARGET=web bun run build` (adapter-node → `build/`), then a pruned
   production `node_modules` for the externalized runtime deps (e.g. `yaml`).
3. **`runtime`** (`node:22-bookworm-slim`) — the `sapphire-server` binary, the
   `build/` output, the production `node_modules`, and the entrypoint. `bookworm`
   on both build and runtime keeps glibc compatible.
