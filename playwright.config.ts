import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against a PRECOMPILED production build served by `vite preview`
 * (adapter-static SPA, fallback to index.html) on port 1420, with the fake
 * backend active (no `__TAURI_INTERNALS__` in Chromium). See ARCHITECTURE.md
 * "Testing".
 *
 * Why preview the build instead of `vite dev`:
 * The suite runs serially (single worker) and used to hit `vite dev`, where the
 * FIRST navigation paid a cold, on-demand compilation cost for the route + heavy
 * deps (CodeMirror, the ~558kB @atomic-editor chunk, ...). That one-time compile
 * intermittently blew the per-test timeout, failing `getByTestId('tree')` on
 * whichever test happened to navigate first — a cold-compile race, not a logic
 * bug (every spec passed in isolation). A production build is fully compiled
 * ahead of time, so there is no on-demand compilation at request time and the
 * race is structurally eliminated. `bun run build` runs once before the server
 * starts (the webServer `command`); `vite preview` then serves static assets.
 */
export default defineConfig({
  testDir: './tests',
  // Serial execution (single worker). The precompiled-serve fix removes the
  // cold-compile contention that previously forced serial-only; serial is kept
  // because it is simple and fast enough for this suite.
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
    // Build the static SPA, then serve it on the fixed port 1420 (strict).
    command: 'bun run build && bun run preview',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    // Generous: covers a clean `bun run build` plus server boot.
    timeout: 180_000,
  },
});
