import { test, expect } from './fixtures';

/**
 * Slice: launcher.
 *
 * Launching Sunstone with no path (`sunstone` alone) shows the launcher: a list
 * of previously-opened folders (most-recent first), each removable, plus an
 * "Open folder…" native picker. Picking a folder opens it in-process and reloads
 * into the editor.
 *
 * The fake backend models launcher mode with `?launcher=1` (currentBundle → null
 * until a folder is opened) and a localStorage-backed known-folder list seeded
 * with three fixtures. This spec drives that to assert:
 *  - the launcher lists the known folders newest-first,
 *  - the X button forgets a folder (drops it from the list),
 *  - clicking a folder opens it and reloads into the editor (the tree appears),
 *  - the "Open folder…" picker opens the chosen folder into the editor.
 */

/** Fresh launcher state: force launcher mode and clear any prior storage. */
async function gotoLauncher(page: import('./fixtures').Page) {
  await page.goto('/?launcher=1');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
}

test('lists known folders newest-first, forgets one, and opens into the editor', async ({
  page,
}) => {
  await gotoLauncher(page);

  const launcher = page.getByTestId('launcher');
  await expect(launcher).toBeVisible();

  // Seeded, newest-first: Knowledge Base (3000) → Project Notes (2000) → Archive (1000).
  const items = page.getByTestId('launcher-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Knowledge Base');
  await expect(items.nth(1)).toContainText('Project Notes');
  await expect(items.nth(2)).toContainText('Archive');

  await page.screenshot({ path: 'tests/screenshots/launcher.png' });

  // Forget the middle folder → it drops out of the list, others remain.
  await page
    .locator('[data-testid="launcher-forget"][data-path="/home/user/Project Notes"]')
    .click();
  await expect(items).toHaveCount(2);
  await expect(page.getByText('Project Notes')).toHaveCount(0);

  // Open a folder → the editor loads (the Explorer tree appears) and the launcher
  // is gone. The reload keeps `?launcher=1`, but the fake now reports the opened
  // Bundle as current, so DesktopShell lands on <App/>.
  await items.nth(0).click();
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('launcher')).toHaveCount(0);
});

test('the "Open folder…" picker opens the chosen folder into the editor', async ({ page }) => {
  await gotoLauncher(page);
  await expect(page.getByTestId('launcher')).toBeVisible();

  // The fake picker returns a canned path; opening it reloads into the editor.
  await page.getByTestId('launcher-open-folder').click();
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('launcher')).toHaveCount(0);
});
