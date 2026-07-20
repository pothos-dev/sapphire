import { test, expect } from '@playwright/test';

/**
 * Slice: persist-sidebar-collapse-state.
 *
 * The left Sidebar's whole-sidebar collapse and each Section's expanded flag now
 * live in the persisted per-Bundle session store (instead of ephemeral local
 * `$state`), so they survive a reload. This drives the fake backend
 * (localStorage-backed, so a page RELOAD restores state exactly as the real
 * backend restores from the OS config file):
 *  - a fresh Bundle opens with the left Sidebar and the Explorer expanded, but
 *    the Tags Section COLLAPSED (its per-field default),
 *  - collapsing the sidebar + expanding the Tags section persists, and both are
 *    restored after a reload.
 */

test('sidebar + section collapse state persists across reload', async ({ page }) => {
  await page.goto('/');

  let tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // Clean slate so the "fresh Bundle" defaults apply deterministically. Clear
  // AFTER the first load (not via addInitScript, which would re-clear on the
  // reload under test) and reload once to boot fresh.
  await page.evaluate(() => window.localStorage.setItem('sapphire:bundleState:/fake/bundle', JSON.stringify({ expandedFolders: ['concepts', 'concepts/editor'] })));
  await page.reload();
  tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // Fresh-Bundle defaults: the left Sidebar is expanded (the toggle is pressed)
  // and the Explorer is expanded, but the Tags Section starts COLLAPSED (its
  // per-field default). Backlinks now lives in the right Sidebar
  // (right-sidebar-move-backlinks), so it is no longer here.
  const sidebarToggle = page.getByTestId('sidebar-toggle');
  await expect(sidebarToggle).toHaveAttribute('aria-pressed', 'true');

  const explorerSection = page.getByTestId('explorer-section');
  const tagsSection = page.getByTestId('tags-section');
  // Each SidebarSection's header toggle reflects expanded state via aria-expanded.
  const explorerToggle = explorerSection.locator('[aria-expanded]').first();
  const tagsToggle = tagsSection.locator('[aria-expanded]').first();
  await expect(explorerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tagsToggle).toHaveAttribute('aria-expanded', 'false');

  // Expand the Tags section, then collapse the whole left Sidebar. This is a
  // non-default state, so restoring it after reload proves the toggles persist.
  await tagsToggle.click();
  await expect(tagsToggle).toHaveAttribute('aria-expanded', 'true');
  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute('aria-pressed', 'false');

  // Give the debounced save time to flush to localStorage.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('sapphire:bundleState:/fake/bundle');
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
      tagsOpen: true,
      explorerOpen: true,
    });

  // RELOAD: the left Sidebar stays COLLAPSED and the Tags section stays
  // EXPANDED, while Explorer stays expanded.
  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();

  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByTestId('tags-section').locator('[aria-expanded]').first(),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByTestId('explorer-section').locator('[aria-expanded]').first(),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.screenshot({ path: 'tests/screenshots/sidebar-collapse-persist.png', fullPage: true });
});

/**
 * Slice: persist-properties-collapse.
 *
 * The Properties panel's collapse is a single sticky preference (like the Sidebar
 * Sections above) persisted in the session store, so minimizing it survives a
 * reload — the regression this slice fixes was that it always reopened expanded.
 */
test('properties panel collapse state persists across reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tree')).toBeVisible();

  // Reset to a deterministic state: concepts/ + concepts/editor/ expanded (concepts/
  // now defaults COLLAPSED as it holds an index.md), everything else at defaults.
  await page.evaluate(() => window.localStorage.setItem('sapphire:bundleState:/fake/bundle', JSON.stringify({ expandedFolders: ['concepts', 'concepts/editor'] })));
  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();

  // Open a Concept so the Properties panel renders. It opens EXPANDED by default.
  await page.locator('[data-path="concepts/bundle.md"]').click();
  const toggle = page.getByTestId('properties-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // Minimize the panel — a non-default state whose restoration proves persistence.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // The debounced save flushes `propertiesOpen: false` to localStorage.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('sapphire:bundleState:/fake/bundle');
        if (!raw) return null;
        return (JSON.parse(raw) as { propertiesOpen?: boolean }).propertiesOpen ?? null;
      }),
    )
    .toBe(false);

  // RELOAD: the last Concept reopens and the Properties panel stays MINIMIZED.
  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('properties-toggle')).toHaveAttribute('aria-expanded', 'false');
});
