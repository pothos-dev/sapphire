import { test, expect } from './fixtures';

/**
 * The read-only "Sapphire Web" viewer (slice: web-readonly-api-walking-skeleton).
 *
 * Drives the SSR'd web shell served by adapter-node against the read-only HTTP
 * backend (`sapphire-server` over the `examples/` Bundle, proxied through
 * `/api`). Asserts:
 *   - the Explorer tree is present (server-rendered, then hydrated),
 *   - clicking a Concept row shows its RAW markdown in the read-only pane,
 *   - NO create/rename/delete/edit affordances exist anywhere.
 * Saves a screenshot to tests/screenshots/web-viewer.png.
 */
test('web viewer renders the tree and reads a Concept read-only', async ({ page }) => {
  await page.goto('/');

  // The web viewer shell (not the desktop <App/>).
  await expect(page.getByTestId('web-viewer')).toBeVisible();
  await expect(page.getByTestId('bundle-root')).toContainText('examples');

  // The Explorer tree is present with Concept rows.
  const concepts = page.getByTestId('tree-concept');
  expect(await concepts.count()).toBeGreaterThan(0);

  // Reader starts empty until a Concept is chosen.
  await expect(page.getByTestId('reader-empty')).toBeVisible();

  // Click a Concept → its raw markdown appears in the read-only pane.
  const first = concepts.first();
  const path = await first.getAttribute('data-path');
  await first.click();
  await expect(page.getByTestId('reader-path')).toHaveText(path ?? '');
  const raw = page.getByTestId('reader-raw');
  await expect(raw).toBeVisible();
  await expect(raw).not.toBeEmpty();

  await page.screenshot({ path: 'tests/screenshots/web-viewer.png', fullPage: true });

  // No write affordances anywhere in the read-only web build: none of the
  // desktop's create/rename/edit controls exist. (Concept rows are themselves
  // buttons — read-only open triggers — so we assert the SPECIFIC write
  // affordances are absent, not "any button".)
  await expect(page.getByTestId('root-new-concept')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ New…' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
