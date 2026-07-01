// Local Playwright override for sandboxes WITHOUT the ms-playwright browser
// cache (where `bunx playwright install` is unavailable). Points Playwright's
// launcher at an already-present system Chromium instead of a downloaded one.
//
// Usage:
//   bunx playwright test -c playwright.local.config.ts
//   CHROMIUM_BIN=/path/to/chromium bunx playwright test -c playwright.local.config.ts
//
// Defaults to /tmp/chromium and runs with --no-sandbox (headless container).
// Everything else (testDir, webServer build+preview, baseURL) is inherited from
// playwright.config.ts. On a normal machine, use playwright.config.ts directly.
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

const executablePath = process.env.CHROMIUM_BIN ?? '/tmp/chromium';

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    launchOptions: { executablePath, args: ['--no-sandbox'] },
  },
});
