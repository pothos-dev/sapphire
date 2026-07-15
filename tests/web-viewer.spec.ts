import { test, expect } from './fixtures';

/**
 * The read-only "Sapphire Web" viewer with SERVER-SIDE RENDER
 * (slices: web-readonly-api-walking-skeleton + web-server-side-render).
 *
 * Drives the SSR'd web shell (adapter-node) against the read-only HTTP backend
 * (`sapphire-server` over the `tests/fixtures/web-bundle` fixture, proxied
 * through `/api`). Asserts:
 *   - the Explorer tree is server-rendered and present,
 *   - opening a Concept shows RENDERED HTML (headings/paragraphs) + a read-only
 *     Properties view (frontmatter), NOT raw markdown / CodeMirror,
 *   - a broken in-Bundle link is present but styled distinct (`.broken`),
 *   - clicking a resolved in-Bundle link navigates WITHIN the viewer (URL
 *     changes, the target renders) — no browser navigation away,
 *   - NO create/rename/delete/edit affordances exist anywhere.
 * Saves a screenshot to tests/screenshots/web-viewer.png.
 */
test('web viewer renders a Concept read-only with resolved + broken links', async ({ page }) => {
  await page.goto('/');

  // The web viewer shell (not the desktop <App/>) with a server-rendered tree.
  await expect(page.getByTestId('web-viewer')).toBeVisible();
  await expect(page.getByTestId('bundle-root')).toBeVisible();
  expect(await page.getByTestId('tree-concept').count()).toBeGreaterThan(0);

  // Open the index Concept (drives ?path=, re-runs load, server-renders).
  await page.getByTestId('tree-concept').filter({ hasText: 'index' }).first().click();
  await expect(page).toHaveURL(/\?path=index\.md/);

  // RENDERED output (not raw markdown): real heading + paragraph elements.
  const rendered = page.getByTestId('rendered');
  await expect(rendered.locator('h1')).toContainText('Web Bundle Home');
  await expect(rendered.locator('p').first()).toBeVisible();

  // Read-only Properties view from frontmatter.
  await expect(page.getByTestId('properties')).toContainText('Web Bundle Home');

  // A broken in-Bundle link is present but visually distinct.
  await expect(rendered.locator('a.internal-link.broken')).toHaveCount(2); // missing.md + [[nope-wiki]]

  // A resolved in-Bundle link exists and navigates WITHIN the viewer.
  const good = rendered.locator('a.internal-link:not(.broken)').first();
  await expect(good).toHaveAttribute('data-path', 'good.md');

  await page.screenshot({ path: 'tests/screenshots/web-viewer.png', fullPage: true });

  await good.click();
  await expect(page).toHaveURL(/\?path=good\.md/);
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Good Concept');

  // No write affordances anywhere in the read-only web build.
  await expect(page.getByTestId('root-new-concept')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ New…' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
