import { test, expect } from '@playwright/test';

/**
 * Slice: persist-sidebar-collapse-state.
 *
 * The left Sidebar's whole-sidebar collapse and each Section's expanded flag now
 * live in the persisted per-Bundle session store (instead of ephemeral local
 * `$state`), so they survive a reload. This drives the fake backend
 * (localStorage-backed, so a page RELOAD restores state exactly as the real
 * backend restores from the OS config file):
 *  - a fresh Bundle opens with the left Sidebar AND every Section expanded,
 *  - collapsing the sidebar + collapsing the Tags section persists, and both
 *    are restored after a reload.
 */

test('sidebar + section collapse state persists across reload', async ({ page }) => {
  await page.goto('/');

  let tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // Clean slate so the "fresh Bundle" defaults apply deterministically. Clear
  // AFTER the first load (not via addInitScript, which would re-clear on the
  // reload under test) and reload once to boot fresh.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // Fresh-Bundle defaults: the left Sidebar is expanded (the toggle is pressed)
  // and its Sections are expanded (Explorer and Tags bodies visible). Backlinks
  // now lives in the right Sidebar (right-sidebar-move-backlinks), so it is no
  // longer here.
  const sidebarToggle = page.getByTestId('sidebar-toggle');
  await expect(sidebarToggle).toHaveAttribute('aria-pressed', 'true');

  const explorerSection = page.getByTestId('explorer-section');
  const tagsSection = page.getByTestId('tags-section');
  // Each SidebarSection's header toggle reflects expanded state via aria-expanded.
  const explorerToggle = explorerSection.locator('[aria-expanded]').first();
  const tagsToggle = tagsSection.locator('[aria-expanded]').first();
  await expect(explorerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tagsToggle).toHaveAttribute('aria-expanded', 'true');

  // Collapse the Tags section, then collapse the whole left Sidebar. This is a
  // non-default state, so restoring it after reload proves the toggles persist.
  await tagsToggle.click();
  await expect(tagsToggle).toHaveAttribute('aria-expanded', 'false');
  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute('aria-pressed', 'false');

  // Give the debounced save time to flush to localStorage.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('emerald:bundleState:/fake/bundle');
        if (!raw) return null;
        return JSON.parse(raw) as {
          leftSidebarOpen?: boolean;
          tagsOpen?: boolean;
          explorerOpen?: boolean;
          backlinksOpen?: boolean;
        };
      }),
    )
    .toMatchObject({
      leftSidebarOpen: false,
      tagsOpen: false,
      explorerOpen: true,
    });

  // RELOAD: the left Sidebar stays COLLAPSED and the Tags section stays
  // collapsed, while Explorer stays expanded.
  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();

  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByTestId('tags-section').locator('[aria-expanded]').first(),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(
    page.getByTestId('explorer-section').locator('[aria-expanded]').first(),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.screenshot({ path: 'tests/screenshots/sidebar-collapse-persist.png', fullPage: true });
});
