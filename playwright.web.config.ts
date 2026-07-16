// Playwright config for the READ-ONLY WEB VIEWER (Sapphire Web).
//
// Unlike the desktop suite (playwright.config.ts, static SPA + in-memory fake),
// the web viewer is architecturally bound to the HTTP backend: it renders only
// in the SSR web build and reads through `/api/*`. So this config boots the
// real read-only stack end-to-end — the `sapphire-server` Rust binary over a
// small committed fixture Bundle (`tests/fixtures/web-bundle`), plus the
// adapter-node SvelteKit server proxying `/api` to it — and drives the viewer
// against that read-only backend (the faithful analog of "the fake backend's
// read-only subset": no write path). The fixture has deterministic content
// (resolvable + broken links, frontmatter, headings) so render assertions hold.
//
// Sandbox note (see CLAUDE.md): this machine's Chromium is flaky, so run over an
// already-running system Chromium via CDP:
//   PW_CDP=http://localhost:9222 bunx playwright test -c playwright.web.config.ts
// The `tests/fixtures.ts` browser fixture connects over CDP when PW_CDP is set;
// otherwise it launches `CHROMIUM_BIN` (default /tmp/chromium) with --no-sandbox.
import { defineConfig, devices } from '@playwright/test';

const RUST_PORT = 8787;
const WEB_PORT = 5199;

export default defineConfig({
  testDir: './tests',
  testMatch: /web-viewer\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
    launchOptions: {
      executablePath: process.env.CHROMIUM_BIN ?? '/tmp/chromium',
      args: ['--no-sandbox'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The read-only Rust API server over the deterministic fixture Bundle.
      command: `cargo build -p sapphire-server && SAPPHIRE_BUNDLE=tests/fixtures/web-bundle SAPPHIRE_API_PORT=${RUST_PORT} ./target/debug/sapphire-server`,
      url: `http://localhost:${RUST_PORT}/api/bundle-root`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // The SSR web build (adapter-node, default `build/` out), proxying /api to
      // the Rust server. `reuseExistingServer` lets a pre-started server be
      // reused (needed in sandboxes that protect in-repo build dirs — build to a
      // temp dir and start it by hand, then Playwright reuses it on this port).
      command: `SAPPHIRE_TARGET=web bun run build && PORT=${WEB_PORT} SAPPHIRE_API_INTERNAL=http://localhost:${RUST_PORT} node build/index.js`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
