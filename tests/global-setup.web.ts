/**
 * Playwright `globalSetup` for the WEB e2e runner. Runs once before the
 * `webServer`s start: it builds the throwaway, seeded git repo the Rust server
 * serves (see `tests/web-bundle.ts`), so a web Save can land a real commit
 * without a nested `.git` polluting the outer Sunstone repo.
 */

import { setupWebBundleRepo } from './web-bundle';

export default function globalSetup(): void {
  const dir = setupWebBundleRepo();
  // eslint-disable-next-line no-console
  console.log(`[web e2e] seeded git fixture Bundle at ${dir}`);
}
