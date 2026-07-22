# Research 01 — Auth approaches for a small self-hosted Sunstone web app

**Ticket:** `../issues/01-research-auth-approaches.md`
**Date:** 2026-07-22
**Web access:** Available. Primary-source facts below were verified via WebSearch
against official docs (oauth2-proxy, Authelia, Auth.js, SvelteKit, GitHub REST).
Sources listed at the end. Anything I could not verify is flagged
**[VERIFY]**.

## Scope & the constraint that shapes everything

Target: *a handful of known, authenticated users* editing **one** self-hosted
Bundle. This is deliberately low-scale — no self-service signup, no password
reset flows, no multi-tenant. That makes heavyweight IdP machinery optional and
tips the balance toward "least ops burden that still gives per-user identity".

### The stack today (what auth has to thread through)

Two facts from the current code decide the whole design:

1. **Two origins, one public.** `src/hooks.server.ts` is a SvelteKit
   `adapter-node` `handle` hook that proxies `/api/*` to the Rust
   `sunstone-server` (default `http://localhost:8787`, env
   `SUNSTONE_API_INTERNAL`). The browser only ever talks to the SvelteKit
   origin; axum is internal. So **the SvelteKit node process is the natural
   trust boundary / policy enforcement point**, and axum sits behind it.

2. **The proxy today forwards almost nothing.** The hook builds the upstream
   request with only a hand-set `accept` header and `event.request.signal`:

   ```ts
   const upstream = await fetch(target, {
     method: event.request.method,
     headers: { accept: isEvents ? 'text/event-stream' : 'application/json' },
     signal: event.request.signal,
   });
   ```

   It does **not** forward the request body, cookies, or an `Authorization`
   header, and axum's routes are all `GET` (read-only). So *any* scheme that
   needs identity (or a write body) at axum **requires editing this hook** to
   forward something — this is not free in any option below.

3. **axum is read-only and has no auth.** `crates/sunstone-server/src/main.rs`
   registers only `GET` routes and validates paths against the bundle root; it
   trusts its caller completely. Whatever we choose, the *write* routes (POST/
   PUT) are new, and the identity they enforce arrives via whatever the proxy
   forwards.

4. **No git library is a dependency yet** (`grep` for `git2|gix|gitoxide` across
   Cargo manifests → nothing). "Persistence is git-backed" is a *plan*, not
   current code. Commit authorship therefore needs a new dep (`git2` = libgit2
   bindings, or `gix`/gitoxide pure-Rust) that takes an author
   `name <email>` + timestamp per commit. **[VERIFY]** which crate the write
   slice will adopt.

### The load-bearing design question

Where is identity **enforced**, and how does it reach the axum **write** routes?
There are only two shapes:

- **(A) Enforce at the edge, axum trusts a header.** A reverse proxy or the
  SvelteKit hook authenticates, then injects a trusted identity header
  (`X-Auth-Request-User`, `Remote-User`, or a custom `X-Sunstone-User`) into the
  upstream request. axum reads that header and uses it as the commit author. The
  entire security of this rests on **axum being unreachable except through the
  trusted hop**, so the header cannot be spoofed by a client. Bind axum to
  `127.0.0.1` (today it binds `0.0.0.0:8787` — see main.rs line ~106,
  `SocketAddr::from(([0, 0, 0, 0], port))`; **[VERIFY]/change**: for a
  header-trust model it must bind loopback or a private network only).

- **(B) Enforce inside axum.** The browser presents a bearer token / signed
  cookie that the proxy forwards verbatim, and axum validates it itself
  (shared secret, or a JWT it can verify). Heavier on the Rust side, but axum is
  self-defending and safe even if exposed.

Every approach below is a variant of (A) or (B).

---

## 1. Reverse-proxy / forward-auth (Authelia, oauth2-proxy, Caddy/Traefik)

**Model: (A) — auth entirely outside the app; app trusts a header.**

A reverse proxy sits in front of *both* the SvelteKit process and (optionally)
does a sub-request to an auth service on every request. On success the proxy
injects identity headers into the upstream request; on failure it 302s the user
to a login page. The app never sees credentials — only the resulting headers.

### How the forward-auth sub-request works (verified)

- **oauth2-proxy** with nginx `auth_request`: run oauth2-proxy with
  `--set-xauthrequest` (`OAUTH2_PROXY_SET_XAUTHREQUEST=true`). nginx hits
  `/oauth2/auth`, which returns `202` (allow) or `401` (deny). On allow, nginx
  copies the response headers into the upstream request:

  ```nginx
  auth_request /oauth2/auth;
  auth_request_set $user  $upstream_http_x_auth_request_user;
  auth_request_set $email $upstream_http_x_auth_request_email;
  proxy_set_header X-User  $user;
  proxy_set_header X-Email $email;
  ```

  Available identity headers: `X-Auth-Request-User`, `X-Auth-Request-Email`,
  `X-Auth-Request-Groups`, `X-Auth-Request-Preferred-Username`, and (with
  `--pass-access-token`) `X-Auth-Request-Access-Token`. oauth2-proxy is a thin
  OIDC/OAuth2 client — it delegates the actual identity to Google/GitHub/any
  OIDC provider; it stores no users itself.

- **Authelia** exposes `/api/authz/forward-auth` and returns `Remote-User`,
  `Remote-Groups`, `Remote-Email`, `Remote-Name`. You must explicitly list them
  for the proxy to forward:
  - **Traefik**: a `forwardAuth` middleware with `trustForwardHeader: true` and
    `authResponseHeaders: [Remote-User, Remote-Groups, Remote-Email,
    Remote-Name]`.
  - **Caddy**: `forward_auth authelia:9091 { uri /api/authz/forward-auth;
    copy_headers Remote-User Remote-Groups Remote-Email Remote-Name }`.
  Authelia has its own user database (a `users.yaml` file for a handful of
  users, or LDAP), TOTP/WebAuthn 2FA, and access-control rules.

- **Caddy/Traefik alone** (no Authelia/oauth2-proxy) can do the `forward_auth` /
  `forwardAuth` plumbing, and Caddy has a first-party `basic_auth` directive
  (bcrypt hashes in the Caddyfile) — genuinely enough for "a handful of known
  users" with near-zero extra infra, at the cost of HTTP Basic's UX (browser
  prompt, no logout).

### CRITICAL gotcha (verified): the trusted-proxy requirement

These identity headers are only safe because the proxy **strips any
client-supplied copy** and re-injects its own. If a client could set
`Remote-User: admin` and reach the backend directly, identity is trivially
forged. Two required mitigations:
- Configure mutual proxy trust (Traefik `forwardedHeaders.trustedIPs`,
  Authelia's trusted-proxy config). A real reported bug: headers silently
  dropped across a 2-host Traefik setup until *both* sides trusted each other's
  IPs.
- **axum must not be reachable except through the trusted hop** (bind loopback /
  private net; today it's `0.0.0.0`).

### How identity reaches axum write routes

The proxy injects e.g. `Remote-User`/`Remote-Email` into the request. **But**
our current topology is browser → SvelteKit hook → axum, and the proxy would sit
in front of SvelteKit. So the SvelteKit hook must **forward the identity header
through** to axum (it currently forwards nothing). Trivial edit: copy
`remote-user`/`remote-email` from `event.request.headers` onto the upstream
`fetch` headers. axum's write handler then reads them.

### Map to git commit authorship

Directly: `Remote-Email` + `Remote-Name` (Authelia) or `X-Auth-Request-Email` +
`...-Preferred-Username` (oauth2-proxy) become the libgit2/gix author signature
`name <email>`. Clean, because the proxy guarantees the values are real for a
known user.

### CSRF

Not a cookie *in our app* — the session cookie belongs to the proxy/auth
service, not SvelteKit. Our app just trusts a header. Standard web CSRF still
applies to the write endpoint (a logged-in user's browser could be tricked into
POSTing), so keep SvelteKit's built-in Origin check on the write route
(see §2). Forward-auth services also set their own SameSite cookies.

### Self-hosting / ops burden

- **Authelia**: highest capability (own user store, 2FA, ACLs) but a *second
  long-running service* + config + a proxy that supports forward-auth. Overkill
  for a handful of users unless you already run it.
- **oauth2-proxy**: one extra service, but you still need an upstream OIDC/OAuth
  provider (so it pairs naturally with "GitHub OAuth" in §4 — oauth2-proxy can
  BE the GitHub-OAuth implementation). Medium burden.
- **Caddy `basic_auth` / Traefik basicAuth**: lowest burden — no extra service,
  just hashes in the proxy config. Weakest UX/security (Basic auth).

---

## 2. App-level session auth in SvelteKit (Auth.js / Lucia / hand-rolled)

**Model: usually (A) with the SvelteKit hook as the enforcement point.**

Here the SvelteKit `adapter-node` server owns login: it issues a session cookie,
validates it in the `handle` hook, and — critically — **the same hook already
proxies `/api`**, so it is the perfect chokepoint. The flow becomes: the hook
first resolves the session (cookie → user), and only if valid does it forward
the `/api/*` request to axum, adding a trusted `X-Sunstone-User` header. axum
still trusts a header (A), but the *issuer/enforcer* is our own SvelteKit
process rather than a separate proxy — no extra service.

This is the natural fit for the existing architecture: extend the one hook we
already have. Concretely, `sequence()` an auth handle before the existing
`/api` proxy handle:

```ts
// authHandle resolves event.locals.user from the session cookie
// apiProxyHandle (today's hook) forwards to axum — now also injects identity
export const handle = sequence(authHandle, apiProxyHandle);
```

### Library options (verified current state, 2026)

- **Auth.js (`@auth/sveltekit`)** — actively maintained, first-class SvelteKit
  support. `SvelteKitAuth({ providers: [GitHub] })` returns `{ handle, signIn,
  signOut }`; session read via `event.locals.auth()`; supports JWT (stateless)
  or database session strategy; needs `AUTH_SECRET` (≥32 chars,
  `openssl rand -hex 32`). Pairs perfectly with GitHub OAuth (§4). This is the
  path-of-least-resistance library choice.
- **Lucia** — **deprecated (March 2025).** The npm `lucia` package (last real
  release 3.2.2, 2024-10) is flagged deprecated and is now a *learning
  resource*, not a library. Do **not** add it as a dependency. Its companion
  **Arctic** (OAuth client, still maintained by the same author, ~593K weekly
  downloads) is the recommended primitive if you *roll your own* sessions and
  just want the OAuth handshake done for you.
- **Hand-rolled cookie sessions** — entirely viable for a handful of users, and
  the "new Lucia" guidance explicitly endorses it: generate a random session
  token, store `hash(token) → userId` in SQLite/a file, set an
  `HttpOnly; Secure; SameSite=Lax` cookie, validate in the hook. Minimal deps,
  full control, but you own expiry/rotation/CSRF correctness.

### How identity reaches axum write routes

The SvelteKit hook is the enforcer. After validating the cookie it forwards to
axum with an injected trusted header (`X-Sunstone-User`/`-Email`). Same
loopback-binding requirement as §1: axum trusts that header **only** because it
is unreachable except via our hook. Alternatively (model B) mint a short-lived
signed token (HMAC/JWT with a shared secret) and have axum verify it — heavier,
but then axum is self-defending.

Either way, **the current hook must be extended** (today it forwards no cookie,
no body). Note also the hook must start forwarding the request **body** for
write routes — today it doesn't.

### Map to git commit authorship

The session already knows the user (esp. if login is GitHub OAuth — you get
name + primary email, §4). Store `name`/`email` on the session and pass them to
axum as the commit author. Fully controllable.

### CSRF (verified — this is the cookie schemes' main exposure)

Cookie auth = CSRF-exposed by definition. Good news: **SvelteKit ships built-in
CSRF protection**, on by default (`kit.csrf.checkOrigin`). It compares the
request `Origin` header to the app origin and returns **403** on mismatch for
state-changing requests. Post-CVE-2023-29003 hardening (≥1.15.1) extended the
check to `text/plain` content type and to `PUT/PATCH/DELETE` (not just
form-content-type `POST`). Caveats:
- The default check covers *form-like* content types
  (`x-www-form-urlencoded`, `multipart/form-data`, `text/plain`). Pure
  `application/json` POSTs are **not** covered by the browser's cross-origin
  rules the same way — but our writes go through `/api` handled by the hook, so
  we should assert the Origin check ourselves on write routes regardless.
- Auth.js has its *own* CSRF token that can conflict with SvelteKit's; the
  common fix (used e.g. by HuggingFace) is `skipCSRFCheck` from `@auth/core` +
  `trustHost: true`, relying on SvelteKit's Origin check instead.
- Newer SvelteKit adds `csrf.trustedOrigins` to allowlist legit cross-site
  posts without disabling protection. Reverse proxies that rewrite `Origin`/
  `X-Forwarded-*` are a known source of false 403s (Fly.io case) — relevant
  since we sit behind a proxy.

Set the cookie `HttpOnly; Secure; SameSite=Lax` (or `Strict`) as the primary
defence; SvelteKit's Origin check is the second layer.

### Self-hosting / ops burden

Lowest *infrastructure* burden — **no extra service**, everything lives in the
node process we already run. With JWT session strategy, no session DB either.
Cost is *code* burden: you own the login UI, cookie handling, and CSRF
correctness. Auth.js absorbs most of it.

---

## 3. Shared secret / bearer token

**Model: (B) — axum validates the credential itself. Simplest possible.**

One static secret (or a small set of per-user tokens) presented as
`Authorization: Bearer <token>`. axum compares (constant-time) against a
configured value/allowlist and allows the write. No sessions, no login page, no
IdP.

### How identity reaches axum write routes

The token is the credential. For a *single* shared secret there is **no
per-user identity** — everyone is the same principal (bad for commit
authorship: every commit looks identical). For **per-user tokens**, map each
token → a `{name, email}` in axum config; the matched entry gives identity.

Delivery through our topology: the browser can't safely hold a bearer token in
JS (XSS-exfiltratable) and the proxy currently forwards no `Authorization`
header. So realistically the token lives server-side: either the SvelteKit hook
holds it (making this really just "the hook is trusted", i.e. collapses into §2/
§1), or it's used for **machine/CLI clients** (curl, scripts, a CI bot) that talk
to `/api` directly. That is arguably its best fit here: a bot/automation
identity, not human browser sessions.

### Map to git commit authorship

Per-user token → static `{name,email}` mapping in axum config. Fine for a
bot ("Sunstone Automation <bot@…>"); crude for humans (identity is only as
granular as the number of tokens you mint and hand out).

### CSRF

**None** — bearer tokens in an `Authorization` header are not sent
automatically by browsers, so there is no CSRF surface (this is the standard
reason token-in-header beats cookies). The flip side is the XSS/storage problem
above if a browser must hold it.

### Self-hosting / ops burden

Near-zero infra. Just a secret in env/config. Ops cost is **token
distribution/rotation done by hand** — tolerable for a handful of users, but no
revocation UX, no login, no per-request freshness. Best as a supplement (CLI/
bot access) rather than the human auth story.

---

## 4. GitHub OAuth

**Model: (A) or (B) depending on where you enforce; attractive because
identity == git commit authorship for free.**

Users log in with GitHub. Because Sunstone's persistence is (planned to be)
git-backed, the GitHub identity maps *directly* to a real git author — no
separate name/email mapping table to maintain, and commits are attributable to
real GitHub accounts (with the avatar/profile that implies).

### How to get commit-authorship data (verified)

- Request scope **`user:email`** (or `user`) during the OAuth handshake.
- Call **`GET https://api.github.com/user/emails`** with the token; find the
  entry where `"primary": true` (and ideally `"verified": true`) → commit
  author **email**. (`GET /user` alone often returns `email: null` — it's only
  the *public* profile email, so use `/user/emails`.)
- `GET /user` gives `name`/`login` for the author **name**.
- Gotcha: scope normalization — requesting `user,user:email` collapses to just
  `user` (still fine); a `404` on `/user/emails` means the token lacks the
  scope.

### Two implementation shells

1. **Inside SvelteKit via Auth.js GitHub provider (§2).** `@auth/sveltekit`
   with `GitHub` provider does the whole OAuth dance; you restrict to your
   handful of users via an allowlist in the `signIn` callback (compare
   `profile.login`/email against a configured set). Identity + name/email land
   in the session; the hook forwards them to axum. **Lowest-friction way to get
   GitHub OAuth** and stays in-process (no extra service). Recommended shell.
2. **Via oauth2-proxy configured with GitHub (§1).** oauth2-proxy natively
   supports a GitHub provider and can restrict by org/team/email; it then
   injects `X-Auth-Request-Email`/`-User`. This is the forward-auth flavour —
   pick it if you already want a reverse-proxy SSO layer, else it's an extra
   service to run.

### CSRF

If wrapped in a cookie session (shell 1), same CSRF story as §2 (SvelteKit
Origin check + `SameSite` cookie; watch the Auth.js-vs-SvelteKit double-CSRF —
use `skipCSRFCheck`). The OAuth handshake itself uses the `state` parameter
against login-CSRF (Auth.js/oauth2-proxy handle this for you).

### Self-hosting / ops burden

- Requires registering a **GitHub OAuth App** (client id/secret) — one-time,
  and a dependency on GitHub being reachable at login time (fine for a
  git-backed tool that already depends on GitHub).
- Shell 1 (Auth.js) = no extra service, small config. Shell 2 (oauth2-proxy) =
  one extra service.
- Restricting to "a handful of known users" is an allowlist check
  (email/login), or an org/team membership check.

---

## Comparison table

| Approach | Identity → axum write route | Git authorship mapping | CSRF exposure | Ops burden |
|---|---|---|---|---|
| **Forward-auth (Authelia)** | Proxy injects `Remote-User/-Email/-Name`; hook forwards to axum; axum trusts header (axum must be loopback-bound) | Direct: `Remote-Name <Remote-Email>` | App uses header not cookie; keep Origin check on write | High: extra service + forward-auth proxy + own user store/2FA |
| **Forward-auth (oauth2-proxy)** | `X-Auth-Request-Email/-User` header, same trust model | Direct from OIDC/GitHub email | Same as above | Medium: extra service + upstream IdP (pairs w/ GitHub) |
| **Caddy `basic_auth`/Traefik** | Proxy validates Basic creds, injects user header | Manual user→email map in config | Basic auth, no cookie CSRF | Lowest infra (hashes in Caddyfile); weak UX |
| **SvelteKit session (Auth.js)** | Hook validates cookie, injects `X-Sunstone-User`; axum trusts header | From session (esp. GitHub) | **Yes** — mitigated by SvelteKit built-in Origin check + `SameSite`/`HttpOnly`; watch Auth.js double-CSRF | Low: no extra service; code burden (Auth.js absorbs it) |
| **SvelteKit session (hand-rolled)** | Same as above | Store name/email on session | Same; you own correctness | Low infra, higher code burden; Lucia is deprecated — use Arctic if needed |
| **Shared secret** | Single `Bearer` in header (server/CLI-held) | None (one principal) | **None** (header not auto-sent) | Near-zero; no per-user identity |
| **Per-user bearer tokens** | `Bearer` → token→{name,email} map in axum | Crude, per-token | None | Near-zero infra; manual token mgmt |
| **GitHub OAuth (via Auth.js)** | Cookie session → hook injects identity | **Best: GitHub primary email + name = git author** | Yes; same mitigations as session | Low: GitHub OAuth App + allowlist, no extra service |
| **GitHub OAuth (via oauth2-proxy)** | Forward-auth header | Same, from GitHub | Header-trust | Medium: extra service |

## Cross-cutting facts to carry into the decision

- **The `/api` proxy hook (`src/hooks.server.ts`) must be extended no matter
  what**: it forwards no cookie, no `Authorization`, and no request **body**
  today. Write support + identity forwarding both require touching it. It is
  also the most natural single enforcement point (it already sees every `/api`
  request).
- **axum currently binds `0.0.0.0:8787` and trusts its caller fully.** Any
  header-trust model (A) is only safe if axum is made unreachable except through
  the trusted hop (bind `127.0.0.1` or a private network). **[VERIFY]/change.**
- **No git dependency exists yet.** Commit authorship needs `git2` (libgit2) or
  `gix` (gitoxide) added to `sunstone-server`/a write crate; both take an author
  `name <email>` + time signature. **[VERIFY]** which.
- **Lucia is out** (deprecated 2025). For app-level sessions the realistic
  choices are Auth.js (batteries included) or hand-rolled + Arctic.
- **CSRF only bites the cookie schemes.** Header/bearer schemes have no CSRF
  surface. SvelteKit's built-in Origin check (403, covers POST/PUT/PATCH/DELETE
  with form/text content types since 1.15.1) is the ready-made mitigation, but
  assert it explicitly on JSON write routes.

## Recommendation (for the decision ticket, not the final word)

For *a handful of known users* + *git-backed persistence*, **GitHub OAuth
implemented in-process via `@auth/sveltekit` (a SvelteKit cookie session),
enforced in the existing `/api` proxy hook, forwarding a trusted identity header
to a loopback-bound axum** is the best fit:

- Identity == git author for free (GitHub primary email + name).
- No extra long-running service (unlike Authelia/oauth2-proxy).
- Restrict to known users with a `signIn` allowlist.
- CSRF handled by SvelteKit's built-in Origin check + `SameSite`/`HttpOnly`
  cookie (skip Auth.js's own CSRF to avoid the double-check).

Add a **shared/per-user bearer token** as a *secondary* path for CLI/bot writes
(no CSRF, no browser). Forward-auth (Authelia/oauth2-proxy) is the right answer
only if a reverse-proxy SSO layer is wanted for other reasons — for this scale
it is more infra than the problem needs.

## Sources

- oauth2-proxy nginx integration (`--set-xauthrequest`, `X-Auth-Request-*`):
  <https://oauth2-proxy.github.io/oauth2-proxy/configuration/integrations/nginx/>,
  <https://github.com/oauth2-proxy/oauth2-proxy/blob/master/contrib/local-environment/nginx.conf>
- Authelia forward-auth headers & trusted-proxy requirement:
  <https://www.authelia.com/integration/trusted-header-sso/introduction/>,
  <https://www.authelia.com/integration/proxies/forwarded-headers/>,
  <https://www.authelia.com/integration/proxies/caddy/>,
  <https://github.com/authelia/authelia/discussions/8121>
- Auth.js SvelteKit (`@auth/sveltekit`, `event.locals.auth()`, `sequence`,
  `skipCSRFCheck`): <https://authjs.dev/reference/sveltekit>,
  <https://svelte.dev/docs/kit/auth>
- Lucia deprecation (now a learning resource; Arctic still maintained):
  <https://github.com/lucia-auth/lucia>,
  <https://github.com/lucia-auth/lucia/discussions/1714>
- SvelteKit built-in CSRF (`kit.csrf.checkOrigin`, CVE-2023-29003 hardening to
  PUT/PATCH/DELETE + text/plain, `trustedOrigins`):
  <https://svelte.dev/docs/kit/configuration>,
  <https://advisories.gitlab.com/pkg/npm/@sveltejs/kit/CVE-2023-29003/>
- GitHub OAuth email/name for commit author (`user:email`, `/user/emails`,
  `primary`): <https://docs.github.com/en/rest/users/emails>,
  <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
