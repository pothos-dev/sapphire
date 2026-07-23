# Dex OIDC provider with the dev config BAKED IN (docker-compose.dex.yml).
#
# The config is copied into the image rather than bind-mounted because the Docker
# daemon in this dev sandbox does not share the host filesystem with the workspace
# (a bind mount of ./docker/dex/config.yaml resolves to an empty dir on the
# daemon). Baking it in keeps `docker compose ... up --build` a single, portable
# step. Build context is ./docker/dex.
FROM ghcr.io/dexidp/dex:v2.41.1
COPY config.yaml /etc/dex/config.yaml
