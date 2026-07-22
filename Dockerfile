# syntax=docker/dockerfile:1
#
# Sunstone Web — single-image, multi-stage build.
#
# The image bundles TWO server processes (see docker/entrypoint.sh):
#   - sunstone-server : the read-only Rust API (axum) over sunstone-core.
#   - node build      : the SvelteKit adapter-node SSR web server.
#
# This is the WEB deployment only. The Tauri desktop app (src-tauri) is NOT
# built or shipped here — src-tauri sources are copied into the Rust stage only
# because it is a Cargo *workspace member* (its manifest must be present to
# resolve the workspace), but nothing in it is compiled: we build just the
# `sunstone-server` package.

# ---------------------------------------------------------------------------
# Stage 1 — Rust API: compile sunstone-server in release mode.
# bookworm base so the resulting glibc matches the node:*-bookworm-slim runtime.
# ---------------------------------------------------------------------------
FROM rust:1-bookworm AS rust-build
WORKDIR /app

# Workspace manifests + lockfile first (with the crate sources) so the build
# resolves the pinned dependency graph. src-tauri is copied for workspace
# resolution only; `-p sunstone-server` never compiles it.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml

# A workspace member must have its declared source roots present to parse, even
# when it is not the package being built. src-tauri declares a [lib]
# (src/lib.rs), a default bin (src/main.rs) and a build script (build.rs);
# provide empty stubs so Cargo can load the workspace without compiling the real
# Tauri app or downloading its (tauri*) dependencies.
RUN mkdir -p src-tauri/src \
 && : > src-tauri/src/lib.rs \
 && echo 'fn main() {}' > src-tauri/src/main.rs \
 && echo 'fn main() {}' > src-tauri/build.rs

# Build only the server package. Cache the cargo registry and target dir across
# builds; copy the finished binary OUT of the (non-persisted) cache mount.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release -p sunstone-server \
 && cp target/release/sunstone-server /usr/local/bin/sunstone-server

# ---------------------------------------------------------------------------
# Stage 2 — Frontend: build the SvelteKit adapter-node output with bun.
# ---------------------------------------------------------------------------
FROM oven/bun:1 AS web-build
WORKDIR /app

# Install ALL deps (build needs vite/svelte-kit/adapters). The patch in
# patches/ is applied by bun during install, so copy it before installing.
COPY package.json bun.lock ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Frontend sources (node_modules is excluded via .dockerignore, so the layer
# above is not clobbered).
COPY . .

# SUNSTONE_TARGET=web selects adapter-node (see svelte.config.js); output -> build/.
RUN SUNSTONE_TARGET=web bun run build

# Prune to a PRODUCTION-only node_modules for the runtime image. adapter-node
# bundles the app but leaves externalized deps (e.g. `yaml`) to be resolved from
# node_modules at runtime.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    rm -rf node_modules \
 && bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# Stage 3 — Runtime: slim node image running both processes.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SUNSTONE_API_PORT=8787 \
    SUNSTONE_API_INTERNAL=http://localhost:8787 \
    SUNSTONE_BUNDLE=/bundle

# Rust API binary + the adapter-node build + its production node_modules.
COPY --from=rust-build /usr/local/bin/sunstone-server /usr/local/bin/sunstone-server
COPY --from=web-build /app/build ./build
COPY --from=web-build /app/node_modules ./node_modules
COPY --from=web-build /app/package.json ./package.json

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Public SSR web port (the Rust API on 8787 stays internal to the container).
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
