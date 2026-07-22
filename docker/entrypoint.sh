#!/usr/bin/env bash
#
# Sunstone Web container entrypoint.
#
# Runs BOTH processes that make up the web deployment in one container:
#
#   1. sunstone-server — the read-only Rust API over the mounted Bundle
#      (binds 0.0.0.0:${SUNSTONE_API_PORT}, reads ${SUNSTONE_BUNDLE}).
#   2. node build      — the SvelteKit adapter-node SSR server (binds
#      ${HOST}:${PORT}); its `/api/*` proxy + SSR loads reach the API at
#      ${SUNSTONE_API_INTERNAL} (http://localhost:${SUNSTONE_API_PORT}).
#
# The script is PID 1. It forwards SIGTERM/SIGINT to both children and, via
# `wait -n`, exits as soon as EITHER child dies — so a crash of the API or the
# web server tears the whole container down (and Docker/compose can restart it)
# instead of leaving a half-dead container serving errors.

set -euo pipefail

API_PORT="${SUNSTONE_API_PORT:-8787}"
export SUNSTONE_API_PORT="${API_PORT}"
# The SSR server and its /api proxy always talk to the API on loopback inside
# the container; default it here so a bare `docker run` still wires up.
export SUNSTONE_API_INTERNAL="${SUNSTONE_API_INTERNAL:-http://localhost:${API_PORT}}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"

pids=()

term() {
  # Forward the stop signal to both children; ignore "already gone" errors.
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
}
trap term TERM INT

echo "sunstone-web: starting API (sunstone-server) on :${API_PORT}, bundle=${SUNSTONE_BUNDLE:-<default>}"
sunstone-server &
pids+=("$!")

echo "sunstone-web: starting SSR web server (node build) on ${HOST}:${PORT}"
node build &
pids+=("$!")

# Block until either child exits, then bring the other down and propagate the
# exit code so the container stops (not restarts silently as a zombie).
set +e
wait -n
code=$?
set -e
echo "sunstone-web: a child process exited (code ${code}); shutting down the container"
term
wait
exit "$code"
