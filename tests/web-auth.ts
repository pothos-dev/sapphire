import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { TEST_AUTH_NAME } from './web-bundle';

/**
 * Log a Playwright page in through the REAL Auth.js sign-in flow (ticket 09 §3).
 *
 * The web e2e server runs with `SUNSTONE_TEST_AUTH=1`, which enables the
 * env-gated `test` Credentials provider (`src/auth.ts`) yielding the fixed
 * `Web Test User` identity. `@auth/sveltekit` disables Auth.js's own CSRF token
 * (`skipCSRFCheck`) and relies on SvelteKit's built-in Origin check, so signing
 * in is a single `POST /auth/callback/test` — no `/auth/csrf` round-trip. The
 * one requirement is a matching `Origin` header: adapter-node defaults its own
 * origin to `https://<host>` (no `ORIGIN`/`PROTOCOL_HEADER` env here), so a POST
 * whose Origin is `http://…` is rejected as cross-site — we send the `https://`
 * origin for the same host/port the page is served on.
 *
 * The request context shares the browser context's cookie jar, so the session
 * cookie is live for the subsequent `page.goto` (SSR reads it → `data.user`),
 * exercising the whole session → hook JWT-mint → axum verify chain on a write.
 */
export async function signInAsTestUser(page: Page): Promise<void> {
  // Establish the page origin (and learn the host:port) before the API sign-in.
  await page.goto('/');
  const origin = `https://${new URL(page.url()).host}`;

  const request = page.context().request;
  const res = await request.post('/auth/callback/test', {
    headers: { origin },
    form: { callbackUrl: '/' },
    // Do NOT follow the 302 to `https://…/` (https isn't served) — the session
    // cookie is set on the redirect response itself, which is all we need.
    maxRedirects: 0,
  });
  expect(res.status(), 'sign-in callback should redirect/succeed').toBeLessThan(400);

  // Confirm the session is live and carries the fixed test identity before the
  // spec relies on the Edit affordance.
  const session = (await (await request.get('/auth/session')).json()) as {
    user?: { name?: string };
  };
  expect(session.user?.name).toBe(TEST_AUTH_NAME);
}

/**
 * Sign the page OUT through the real Auth.js `POST /auth/signout` — what the
 * UI's client `signOut()` ultimately hits. Auth.js's own CSRF token is disabled
 * in this build (`skipCSRFCheck`), so no `/auth/csrf` round-trip is needed; the
 * SvelteKit Origin check still applies. Driven through the request context (not
 * the sign-out BUTTON) for the same reason as sign-in: adapter-node defaults its
 * origin to `https://<host>` here (no `ORIGIN` env), so a browser POST whose
 * Origin is `http://…` is rejected as cross-site — we send the `https://` origin.
 * Shares the browser context's cookie jar, so the session cookie is cleared for
 * the page.
 */
export async function signOutTestUser(page: Page): Promise<void> {
  const origin = `https://${new URL(page.url()).host}`;
  const request = page.context().request;
  const res = await request.post('/auth/signout', {
    headers: { origin },
    form: { callbackUrl: '/' },
    maxRedirects: 0,
  });
  expect(res.status(), 'sign-out should redirect/succeed').toBeLessThan(400);

  // Logged out, `/auth/session` returns literal `null` (not `{}`).
  const session = (await (await request.get('/auth/session')).json()) as { user?: unknown } | null;
  expect(session?.user, 'session cleared after sign-out').toBeFalsy();
}
