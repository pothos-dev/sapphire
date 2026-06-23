import { test, expect } from '@playwright/test';

/**
 * Slice: quick-nav-palette.
 *
 * Drives the Ctrl+K command palette against the fake backend:
 *  - Ctrl+K opens it; typing a fragment fuzzy-matches a Concept path; Enter
 *    opens the highlighted match (through editor navigation/history).
 *  - With EMPTY input the palette shows recent files, most-recent first;
 *    arrow + Enter opens one.
 *  - Recent files persist across a reload (localStorage-backed fake = the real
 *    OS-config persistence path).
 */

test('quick-nav: fuzzy match, recent files, persistence', async ({ page }) => {
  await page.goto('/');

  let tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // Clean slate so recent files start empty and deterministic.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // --- Fuzzy match + Enter opens through navigation ---
  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('quick-nav');
  await expect(palette).toBeVisible();

  // "cm" should fuzzy-match concepts/codemirror.md (subsequence c..m).
  await page.getByTestId('quick-nav-input').fill('codem');
  const codemirror = palette.locator('[data-path="concepts/codemirror.md"]');
  await expect(codemirror).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByTestId('editor')).toContainText('CodeMirror 6 is the editor core');

  // Open a second Concept via the palette so we have two recents.
  await page.keyboard.press('Control+k');
  await page.getByTestId('quick-nav-input').fill('bundle');
  const bundleItem = palette.locator('[data-path="concepts/bundle.md"]');
  await expect(bundleItem).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor')).toContainText('is the root folder opened by Sapphire');

  // --- Empty input shows recent files, most-recent first ---
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await expect(page.getByTestId('quick-nav-hint')).toHaveText('Recent files');

  const recentPaths = await palette
    .getByTestId('quick-nav-item')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));
  // Most-recent first: bundle (opened last) before codemirror.
  expect(recentPaths.slice(0, 2)).toEqual(['concepts/bundle.md', 'concepts/codemirror.md']);

  await page.screenshot({ path: 'tests/screenshots/quick-nav.png', fullPage: true });

  // ArrowDown selects the second recent (codemirror); Enter opens it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByTestId('editor')).toContainText('CodeMirror 6 is the editor core');

  // --- Recent files persist across reload ---
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('sapphire:bundleState:/fake/bundle');
        return raw ? (JSON.parse(raw) as { recentFiles?: string[] }).recentFiles ?? null : null;
      }),
    )
    .toEqual(['concepts/codemirror.md', 'concepts/bundle.md']);

  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('quick-nav')).toBeVisible();
  const afterReload = await page
    .getByTestId('quick-nav')
    .getByTestId('quick-nav-item')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));
  expect(afterReload.slice(0, 2)).toEqual(['concepts/codemirror.md', 'concepts/bundle.md']);
});
