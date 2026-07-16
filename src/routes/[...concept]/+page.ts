import type { PageLoad } from './$types';
import { loadConcept } from '$lib/web/loadConcept';

/**
 * Concept-by-path load (`/providers`, `/research/providers/mistral-ai`, …).
 *
 * WEB build only: `params.concept` is the pretty, already-decoded path; it is
 * resolved to a real Concept and server-rendered (see `loadConcept`). The
 * root `/` is handled by the sibling `src/routes/+page.ts`. In the DEFAULT
 * desktop/Tauri build the body is dead-code-eliminated (`__SAPPHIRE_WEB__` is a
 * compile-time `false`) and this route only exists so the static SPA's client
 * router can match any deep link back to `<App/>`.
 */
export const load: PageLoad = async ({ fetch, params }) => {
  if (!__SAPPHIRE_WEB__) {
    return { web: false as const };
  }
  return loadConcept(fetch, params.concept);
};
