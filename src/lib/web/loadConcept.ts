import type { TreeNode } from '$lib/types';
import type { RenderPayload } from './render';
import { collectFilePaths, urlToConcept } from './conceptUrl';

/** SSR'd data the web `+page` routes hand to the viewer. */
export interface WebPageData {
  web: true;
  bundleRoot: string;
  tree: TreeNode;
  selected: string | null;
  rendered: RenderPayload | null;
  renderError: string | null;
  /**
   * The authenticated user (Auth.js session), or `null` when signed out. Read
   * from the Auth.js `/auth/session` endpoint through the same relative `fetch`
   * (SSR or client), so the viewer can show the Edit affordance ONLY to a
   * signed-in user (ticket 06). Only the display `name` is carried.
   */
  user: { name: string } | null;
}

/** The subset of the Auth.js session JSON the viewer needs. */
interface SessionResponse {
  user?: { name?: string | null } | null;
}

/** Fetch the current user from Auth.js, or `null` when signed out / on error. */
async function loadUser(fetchFn: typeof fetch): Promise<{ name: string } | null> {
  try {
    const res = await fetchFn('/auth/session');
    if (!res.ok) return null;
    const session = (await res.json()) as SessionResponse | null;
    const name = session?.user?.name;
    return name ? { name } : null;
  } catch {
    return null;
  }
}

/**
 * Load the Bundle root + Explorer tree and, for the Concept addressed by
 * `urlPath` (a pretty, already-decoded path like `research/providers/mistral-ai`
 * or `''` for the root), the server-rendered payload — so first paint shows the
 * RENDERED Concept without waiting on hydration.
 *
 * `fetch` is relative (`/api/...`), routed through the SvelteKit server (SSR) or
 * the browser origin (client nav), both proxied to `sunstone-server` (see
 * `src/hooks.server.ts`). The pretty path is resolved to a real Concept path
 * against the tree's file set (`urlToConcept`); an unknown path renders empty.
 */
export async function loadConcept(fetchFn: typeof fetch, urlPath: string): Promise<WebPageData> {
  const [bundleRoot, tree, user] = await Promise.all([
    fetchFn('/api/bundle-root').then((r) => r.json() as Promise<string>),
    fetchFn('/api/tree').then((r) => r.json() as Promise<TreeNode>),
    loadUser(fetchFn),
  ]);

  const selected = urlToConcept(urlPath, collectFilePaths(tree));
  let rendered: RenderPayload | null = null;
  let renderError: string | null = null;
  if (selected) {
    const res = await fetchFn(`/api/render?path=${encodeURIComponent(selected)}`);
    if (res.ok) {
      rendered = (await res.json()) as RenderPayload;
    } else {
      // Broken/missing target: keep the shell, surface the error read-only.
      renderError = `${res.status}: ${(await res.text().catch(() => '')) || 'not found'}`;
    }
  }

  return { web: true, bundleRoot, tree, selected, rendered, renderError, user };
}
