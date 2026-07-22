# 01 — Research: auth approaches for a small self-hosted web app

Type: research
Status: claimed
Blocked by: None

## Question

For "a handful of known, authenticated users" editing a single self-hosted Bundle,
what are the realistic authentication approaches, and what are their trade-offs for
**this** stack (SvelteKit adapter-node SSR frontend + a `/api` proxy → axum Rust
server)?

Survey and compare at least:

- **Reverse-proxy auth** (Authelia / oauth2-proxy / Caddy/Traefik forward-auth) —
  auth handled entirely outside the app; the app trusts a header for identity.
- **App-level session auth** in SvelteKit (Auth.js / Lucia / hand-rolled cookie
  sessions) — where does the session get enforced given the `/api` proxy hop to axum?
- **Shared secret / bearer token** — simplest; is it enough for "few known users"?
- **GitHub OAuth** — attractive because persistence is git-backed (identity could
  map straight to commit authorship).

For each: how identity reaches the **axum write routes** (the trust boundary is the
proxy → axum hop), how it maps to **git commit authorship**, CSRF exposure for
cookie-based schemes, and self-hosting/ops burden. Capture concrete facts (library
names, how forward-auth headers work, session-over-proxy patterns), not opinions.

Write findings to `.scratch/enable-web-writing/research/01-auth-approaches.md` and
link them here on resolution. Feeds the *Auth & git-identity model* decision.
