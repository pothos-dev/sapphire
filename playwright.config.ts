import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against `vite dev` (port 1420) with the fake backend active
 * (no `__TAURI_INTERNALS__` in Chromium). See ARCHITECTURE.md "Testing".
 */
export default defineConfig({
  testDir: './tests',
  // Serial execution (single worker): tests share one cold Vite dev server, and
  // running them in parallel makes workers contend on first-request compilation
  // and time out — environmental flakiness, not a code bug. Serial is stable and
  // fast enough for the suite. This is the sanctioned config for all slices.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
