import { test, expect } from '@playwright/test';

/**
 * Slice: config-theme-state-store.
 *
 * Verifies the per-Bundle session persistence + OS-driven theming against the
 * fake backend (localStorage-backed, so a page RELOAD restores state exactly as
 * the real backend restores from the OS config file):
 *  - opens a Concept and expands a deep folder, reloads, asserts both restored,
 *  - asserts the app root carries a `data-theme` reflecting the color scheme,
 *  - drives `prefers-color-scheme: dark` and asserts `data-theme="dark"`.
 */

test('session state persists across reload; theme follows OS', async ({ page }) => {
  await page.goto('/');

  let tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // Start from a clean slate so the "fresh Bundle" defaults apply
  // deterministically. Clear AFTER the first load (not via addInitScript, which
  // would re-clear on every navigation, including the reload under test) and
  // reload once to boot fresh.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  const appRoot = page.getByTestId('app-root');
  // The app root must carry a data-theme reflecting the color scheme. The
  // default emulated scheme is light.
  await expect(appRoot).toHaveAttribute('data-theme', /^(light|dark)$/);

  // `concepts/` and `concepts/editor/` are expanded by default (depth < 2), so
  // the deep Concept is visible. Open it, then COLLAPSE `concepts/editor/` to
  // produce a non-default folder state — restoring it after reload proves
  // expand/collapse changes persist, not just defaults.
  const livePreview = tree.locator('[data-path="concepts/editor/live-preview.md"]');
  await expect(livePreview).toBeVisible();
  await livePreview.click();

  const editorPane = page.getByTestId('editor');
  await expect(editorPane).toContainText('Obsidian-style hybrid editing');

  // Collapse `concepts/editor` (its toggle reads "editor"); the deep file hides.
  await tree.locator('button.dir-toggle', { hasText: 'editor' }).click();
  await expect(livePreview).toBeHidden();

  // Give the debounced save time to flush to localStorage: the open Concept is
  // the deep one, and the expanded set no longer contains `concepts/editor`.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('emerald:bundleState:/fake/bundle');
        if (!raw) return null;
        return JSON.parse(raw) as { lastOpenConcept: string | null; expandedFolders: string[] };
      }),
    )
    .toMatchObject({
      lastOpenConcept: 'concepts/editor/live-preview.md',
      expandedFolders: expect.not.arrayContaining(['concepts/editor']),
    });

  // RELOAD: the last-open Concept reopens; `concepts/editor` stays COLLAPSED
  // (its child hidden) while `concepts` stays expanded.
  await page.reload();

  await expect(page.getByTestId('tree')).toBeVisible();
  // The deep Concept's row is hidden because `concepts/editor` is collapsed,
  // but `concepts/` itself is still expanded (its toggle is visible).
  await expect(page.getByTestId('tree').locator('button.dir-toggle', { hasText: 'editor' })).toBeVisible();
  await expect(
    page.getByTestId('tree').locator('[data-path="concepts/editor/live-preview.md"]'),
  ).toBeHidden();
  // The last-open Concept is reopened (open state is independent of tree visibility).
  await expect(page.getByTestId('editor')).toContainText('Obsidian-style hybrid editing');

  await page.screenshot({ path: 'tests/screenshots/config-state.png', fullPage: true });
});

test('dark color scheme yields data-theme="dark"', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('app-root')).toHaveAttribute('data-theme', 'dark');

  await context.close();
});
