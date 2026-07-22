# 04 — Auth & git-identity model

Type: grilling
Status: resolved
Blocked by: 01

## Question

Decide the concrete authentication model for web writing, and how an authenticated
user's identity maps to **git commit authorship**.

Resolve:

- Which auth approach (from ticket 01's survey) we adopt, and *why* it fits "few known
  users" + self-hosted + git-backed.
- Where the trust boundary is enforced — at the SvelteKit layer, the `/api` proxy hop,
  or inside axum — and how identity reaches the **write** routes specifically (reads
  stay open? or is the whole app gated?).
- The viewer-vs-editor consequence: is unauthenticated access a read-only viewer, or
  is everything behind login?
- How a request's identity becomes the commit **author** (name/email), and what the
  committer is.
- CSRF / token handling for the write routes.

This is the foundation the write-route surface (ticket 07) and git model (ticket 05)
build on. Record the decision under `## Answer`.

## Answer

**Provider-agnostic OAuth/OIDC login (`@auth/sveltekit`, in-process cookie session),
enforced at the SvelteKit `/api` hook, which mints a short-lived HS256 JWT that axum
independently verifies on every write.** Reads stay open; only writes are gated.

### 1. Mechanism — generic OAuth/OIDC, not GitHub-specific

Use `@auth/sveltekit` as a plain OAuth/OIDC **client**. Any provider that returns
`name` + `email` is usable — GitHub, Google, a generic OIDC provider, or **Dex**
fronting LDAP/password (the app only ever speaks OAuth; adapters like Dex handle
non-OAuth backends). No extra long-running service is part of *Sunstone*; the OIDC
provider is external/operator-run.

*Why:* fits "few known users" + self-hosted + git-backed — the OIDC `name`/`email`
claims become the git author for free, with zero user→identity mapping table to
maintain. Rejected: forward-auth (Authelia/oauth2-proxy) is more infra than this
scale needs; a bearer token is a poor primary human-auth story; Lucia is deprecated
(2025) so app-session-if-hand-rolled would use Arctic, but Auth.js absorbs it.

### 2. Anonymous access — reads open, writes gated

Anonymous visitors keep today's public read-only SSR viewer. The session is checked
**only on write routes**; reading needs no auth. (Flip to fully-gated only if Bundle
*content* itself becomes confidential — not the case now.)

### 3. Trust boundary — hook enforces, **axum self-defends** via JWT

The browser only ever talks to the SvelteKit node process; `/api/*` is proxied to
axum. The `/api` hook is the single enforcement chokepoint:

- On a write, the hook resolves the session cookie → user, and **only if valid** mints
  a signed token and forwards the request (with body — see §8) to axum.
- **axum verifies the token itself** on every write (chosen over header-trust). axum is
  therefore self-defending: safe even if reachable on the network. Binding axum to
  loopback (`127.0.0.1`, today it's `0.0.0.0:8787`) becomes **optional
  defense-in-depth**, no longer load-bearing.

### 4. Token — HS256, per-request, short-lived

- **Symmetric HMAC (JWT HS256)**, one shared secret in env read by both the hook (mint)
  and axum (verify). Single issuer + single verifier in one trust domain → asymmetric
  keys buy nothing.
- **Minted per-request, ~60s TTL** (sensible default). Claims: `{ sub, name, email,
  iat, exp }`. The token lives server-side only (hook → axum); it never reaches the
  browser, so there is no XSS-exfiltration or CSRF surface on it.

### 5. Commit identity

- **Author = the authenticated user** — `name` + `email` from the OIDC claims, carried
  in the JWT, used as the libgit2/gix/CLI author signature.
- **Committer = same as author** (chosen for simplicity over a fixed service identity).

### 6. Authorization — trust the provider

**Authenticated == authorized.** No app-level allowlist; scoping the provider to the
known users is a **deployment responsibility** (the intended shape: a private OIDC
provider such as Dex configured with just those users). **Caveat to document:** wiring
a *public* provider (GitHub/Google) without provider-side scoping would let anyone on
the internet write — the deployment must not do that. (An optional email allowlist is a
future escape hatch, not built now.)

### 7. CSRF

The login session is an Auth.js cookie on the browser→hook hop, so standard cookie-CSRF
applies there. Mitigation: SvelteKit's built-in Origin check (`kit.csrf.checkOrigin`,
covers POST/PUT/PATCH/DELETE) + a `HttpOnly; Secure; SameSite=Lax` session cookie, and
set `skipCSRFCheck` on Auth.js so its own CSRF token doesn't double-fire with
SvelteKit's. The internal JWT is server-to-server → no CSRF surface.

### 8. Carried forward / out of scope

- **`/api` hook must forward the request body** for write routes (today it forwards
  nothing — no cookie, no auth, no body). Both body-forwarding and identity-minting land
  here; details belong to ticket 07 (write-route surface).
- **CLI/bot write path — out of scope.** Web browser editing only; axum accepts exactly
  one write credential (the hook-minted JWT). **Automation clones the git repo and
  commits/pushes via normal git**, so no machine credential on the web API is needed.
  Returns as a fresh effort if ever required.
