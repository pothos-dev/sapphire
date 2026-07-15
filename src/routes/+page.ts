import type { PageLoad } from './$types';
import type { TreeNode } from '$lib/types';

/**
 * Root-page load.
 *
 * Only meaningful in the WEB build: it fetches the Bundle root + Explorer tree
 * so the shell renders server-side (SSR) and then hydrates. `fetch` is relative
 * (`/api/...`), which SvelteKit routes through the server (SSR) or the browser
 * origin (hydration) — both proxied to `sapphire-server` (see
 * `src/hooks.server.ts`).
 *
 * In the DEFAULT (desktop/Tauri) build `__SAPPHIRE_WEB__` is a compile-time
 * `false`, so this whole body is dead-code-eliminated and `load` returns an
 * empty object — the static SPA is untouched and never hits `/api`.
 */
export const load: PageLoad = async ({ fetch }) => {
  if (!__SAPPHIRE_WEB__) {
    return { web: false as const };
  }

  const [bundleRoot, tree] = await Promise.all([
    fetch('/api/bundle-root').then((r) => r.json() as Promise<string>),
    fetch('/api/tree').then((r) => r.json() as Promise<TreeNode>),
  ]);

  return { web: true as const, bundleRoot, tree };
};
