import type { PageLoad } from './$types';
import type { TreeNode } from '$lib/types';
import type { RenderPayload } from '$lib/web/render';

/**
 * Root-page load.
 *
 * Only meaningful in the WEB build: it fetches the Bundle root + Explorer tree,
 * and — when a Concept is selected via `?path=` — the server-rendered payload
 * (`/api/render`), so first paint shows the RENDERED Concept without waiting on
 * client hydration. `fetch` is relative (`/api/...`), which SvelteKit routes
 * through the server (SSR) or the browser origin (hydration / client nav), both
 * proxied to `sapphire-server` (see `src/hooks.server.ts`). Client-side
 * navigation to another Concept changes `?path=` and re-runs this load.
 *
 * In the DEFAULT (desktop/Tauri) build `__SAPPHIRE_WEB__` is a compile-time
 * `false`, so this whole body is dead-code-eliminated and `load` returns
 * `{ web: false }` — the static SPA is untouched and never hits `/api`.
 */
export const load: PageLoad = async ({ fetch, url }) => {
  if (!__SAPPHIRE_WEB__) {
    return { web: false as const };
  }

  const [bundleRoot, tree] = await Promise.all([
    fetch('/api/bundle-root').then((r) => r.json() as Promise<string>),
    fetch('/api/tree').then((r) => r.json() as Promise<TreeNode>),
  ]);

  const selected = url.searchParams.get('path');
  let rendered: RenderPayload | null = null;
  let renderError: string | null = null;
  if (selected) {
    const res = await fetch(`/api/render?path=${encodeURIComponent(selected)}`);
    if (res.ok) {
      rendered = (await res.json()) as RenderPayload;
    } else {
      // Broken/missing target: keep the shell, surface the error read-only.
      renderError = `${res.status}: ${(await res.text().catch(() => '')) || 'not found'}`;
    }
  }

  return { web: true as const, bundleRoot, tree, selected, rendered, renderError };
};
