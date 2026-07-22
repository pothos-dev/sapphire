# 01 — Research: auth approaches for a small self-hosted web app

Type: research
Status: resolved
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

## Answer

For a handful of known users editing a git-backed Bundle, the best fit is **GitHub
OAuth via `@auth/sveltekit` (an in-process cookie session), enforced in the existing
`/api` proxy hook, forwarding a trusted identity header to a loopback-bound axum** —
the GitHub primary email + name become the git commit author for free, with no extra
long-running service, a `signIn` allowlist for access control, and CSRF covered by
SvelteKit's built-in Origin check. Forward-auth (Authelia/oauth2-proxy) is heavier
infra warranted only if a reverse-proxy SSO layer is wanted anyway; a shared/per-user
bearer token is a good *secondary* path for CLI/bot writes (no CSRF surface). Two
things must change regardless of choice: the `/api` hook forwards no cookie/body/auth
today, and axum currently binds `0.0.0.0` and trusts its caller — a header-trust model
needs it loopback-bound. Lucia is deprecated (2025) — do not adopt it.

Full survey: [research/01-auth-approaches.md](../research/01-auth-approaches.md)
