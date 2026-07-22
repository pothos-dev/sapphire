import { test as base, expect, chromium } from '@playwright/test';

/**
 * Test fixtures with an OPT-IN "connect over CDP" mode.
 *
 * When `PW_CDP` is set (to a CDP endpoint, e.g. `http://localhost:9222`), the
 * `browser` fixture connects to an ALREADY-RUNNING Chromium over the Chrome
 * DevTools Protocol instead of launching a fresh one. This is for
 * resource-constrained sandboxes where launching a second Chromium alongside the
 * `vite build`/preview server exhausts memory and the launch is OOM-killed —
 * reusing the running browser sidesteps that. CI (and normal machines) leave
 * `PW_CDP` unset, so the standard launch path (playwright.config.ts) is used and
 * nothing changes.
 *
 * Specs that need to run in-sandbox import `{ test, expect }` from here instead
 * of directly from `@playwright/test`.
 */
const CDP_ENDPOINT = process.env.PW_CDP;

export const test = CDP_ENDPOINT
  ? base.extend({
      browser: [
        // eslint-disable-next-line no-empty-pattern
        async ({}, use) => {
          const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
          await use(browser);
          // Do NOT close: the browser is shared (it was already running); closing
          // it would tear down the sandbox's browser. Playwright drops the CDP
          // connection when the worker process exits.
        },
        { scope: 'worker' },
      ],
    })
  : base;

export { expect };
export type { Page } from '@playwright/test';
