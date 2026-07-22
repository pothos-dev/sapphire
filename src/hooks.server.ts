import type { Handle } from '@sveltejs/kit';

/**
 * Same-origin `/api/*` proxy (WEB build only, adapter-node).
 *
 * The browser-side `http.ts` Backend and SSR `load` both fetch relative
 * `/api/...` so there is ONE public origin (the SvelteKit server) and no CORS.
 * This hook forwards those requests to the Rust `sunstone-server` at an
 * internal base URL (`SUNSTONE_API_INTERNAL`, default `http://localhost:8787`).
 *
 * The upstream response BODY is streamed straight through (not buffered), so
 * the SSE `/api/events` stream reaches the browser incrementally — awaiting the
 * whole body would hang forever on a never-ending stream. Ordinary JSON routes
 * stream fine too (they just end quickly). For `text/event-stream` we add
 * `cache-control: no-cache` so no intermediary buffers the stream.
 *
 * In the DEFAULT desktop build (adapter-static SPA) there is no server at
 * runtime, so this hook is never invoked — the static build is unaffected.
 * Everything except `/api/*` passes straight through to SvelteKit.
 */
const API_INTERNAL = process.env.SUNSTONE_API_INTERNAL ?? 'http://localhost:8787';

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;
  if (pathname.startsWith('/api/')) {
    const target = `${API_INTERNAL}${pathname}${search}`;
    const isEvents = pathname === '/api/events';
    const upstream = await fetch(target, {
      method: event.request.method,
      headers: { accept: isEvents ? 'text/event-stream' : 'application/json' },
      // Let the client abort propagate to the upstream stream (SSE disconnect).
      signal: event.request.signal,
    });

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const headers: Record<string, string> = { 'content-type': contentType };
    if (contentType.includes('text/event-stream')) {
      headers['cache-control'] = 'no-cache';
      headers['connection'] = 'keep-alive';
    }
    // Pass the upstream ReadableStream through un-buffered so SSE streams live.
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  return resolve(event);
};
