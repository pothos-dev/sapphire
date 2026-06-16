import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against `vite dev` (port 1420) with the fake backend active
 * (no `__TAURI_INTERNALS__` in Chromium). See ARCHITECTURE.md "Testing".
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
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
