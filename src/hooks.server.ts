import type { Handle } from '@sveltejs/kit';

/**
 * Same-origin `/api/*` proxy (WEB build only, adapter-node).
 *
 * The browser-side `http.ts` Backend and SSR `load` both fetch relative
 * `/api/...` so there is ONE public origin (the SvelteKit server) and no CORS.
 * This hook forwards those requests to the Rust `sapphire-server` at an
 * internal base URL (`SAPPHIRE_API_INTERNAL`, default `http://localhost:8787`).
 *
 * In the DEFAULT desktop build (adapter-static SPA) there is no server at
 * runtime, so this hook is never invoked — the static build is unaffected.
 * Everything except `/api/*` passes straight through to SvelteKit.
 */
const API_INTERNAL = process.env.SAPPHIRE_API_INTERNAL ?? 'http://localhost:8787';

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;
  if (pathname.startsWith('/api/')) {
    const target = `${API_INTERNAL}${pathname}${search}`;
    const upstream = await fetch(target, {
      method: event.request.method,
      headers: { accept: 'application/json' },
    });
    // Stream the upstream response back verbatim (status + content-type + body).
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  }
  return resolve(event);
};
