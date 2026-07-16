import type { PageLoad } from './$types';
import { loadConcept } from '$lib/web/loadConcept';

/**
 * Root-page load (`/`).
 *
 * In the WEB build this resolves to the Bundle's root `index.md` (the wiki home)
 * — pretty URLs address a Concept by its path, so the root is the empty path.
 * Nested Concepts are served by the `[...concept]` route; both share
 * `loadConcept`. In the DEFAULT (desktop/Tauri) build `__SAPPHIRE_WEB__` is a
 * compile-time `false`, so the body is dead-code-eliminated and the static SPA
 * is untouched (never hits `/api`).
 */
export const load: PageLoad = async ({ fetch }) => {
  if (!__SAPPHIRE_WEB__) {
    return { web: false as const };
  }
  return loadConcept(fetch, '');
};
