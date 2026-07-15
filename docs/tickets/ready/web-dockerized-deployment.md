## What to build

Package Sapphire Web as a Docker image for internal hosting: one container serves
the SSR web app and the read-only API over a Bundle mounted from the host. No auth
(the deployment sits on a private/internal network).

- Multi-stage Dockerfile: build the frontend (`vite build` / SvelteKit adapter-node)
  and compile `sapphire-server` (`cargo build --release`) in build stages; the final
  runtime image runs the server plus the SSR node process and serves the built
  assets.
- The Bundle is provided as a read-only volume mount, its path passed via
  `SAPPHIRE_BUNDLE`. The container reads the Bundle but never writes to it.
- A `docker-compose.yml` wires the image, the bundle volume, and the published port
  for internal access. Document the run in the deploy docs.
- Because there is no auth yet, document that the container must stay on an internal
  network / behind a private proxy and not be exposed publicly.

Type: **AFK**.

## Acceptance criteria

- [ ] Multi-stage Dockerfile builds frontend + `sapphire-server` and produces a runnable image
- [ ] `docker compose up` serves the SSR web viewer against a bundle mounted via `SAPPHIRE_BUNDLE`
- [ ] The mounted Bundle is treated read-only (no writes from the container)
- [ ] Two browsers can view concurrently against the running container (incl. live reload)
- [ ] Deploy docs describe the compose run and the internal-network / no-auth caveat

## Blocked by

- web-readonly-api-walking-skeleton.md
