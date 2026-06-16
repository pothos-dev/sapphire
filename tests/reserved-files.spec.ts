import { test, expect, type Page } from '@playwright/test';

/**
 * Slice: reserved-files.
 *
 * OKF reserved files (`index.md`, `log.md`) get special tree treatment:
 *  - they are NOT shown as ordinary tree leaves,
 *  - a folder containing them shows affordances (icons) that open them directly,
 *  - this applies at EVERY level (Bundle root included),
 *  - right-clicking a folder offers to create whichever reserved file is missing,
 *  - they open + edit as normal markdown and are EXEMPT from the missing-`type` flag.
 *
 * The fixture has: root `index.md` + `log.md`; `concepts/index.md` (no log.md);
 * `concepts/editor/` with neither.
 */

/** Open the per-row ⋯ menu for a tree node by its bundle-relative path. */
async function openRowMenu(page: Page, path: string) {
  const tree = page.getByTestId('tree');
  await tree.locator(`[data-menu-path="${path}"]`).click({ force: true });
  await expect(page.getByTestId('context-menu')).toBeVisible();
}

test('reserved files: stripped from leaves, opened via folder affordances', async ({
  page,
}) => {
  await page.goto('/');

  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // --- Reserved files are NOT ordinary leaves anywhere ---
  await expect(tree.locator('[data-path="index.md"]')).toHaveCount(0);
  await expect(tree.locator('[data-path="log.md"]')).toHaveCount(0);
  await expect(tree.locator('[data-path="concepts/index.md"]')).toHaveCount(0);

  // --- Bundle-root affordances open the reserved files directly ---
  const rootReserved = page.getByTestId('root-reserved');
  await expect(rootReserved.locator('[data-reserved-path="index.md"]')).toBeVisible();
  await expect(rootReserved.locator('[data-reserved-path="log.md"]')).toBeVisible();

  await rootReserved.locator('[data-reserved-path="index.md"]').click();
  // It opens as a normal Concept (Properties panel shows its frontmatter).
  await expect(page.getByTestId('properties')).toBeVisible();
  await expect(page.getByTestId('scalar-type')).toHaveValue('index');

  // --- Subfolder affordance: concepts/ has index.md surfaced on its folder row ---
  await expect(
    tree.locator('[data-reserved-path="concepts/index.md"]'),
  ).toHaveCount(1);
  await tree.locator('[data-reserved-path="concepts/index.md"]').click({ force: true });
  await expect(page.getByTestId('scalar-title')).toHaveValue('Concepts');

  await page.screenshot({ path: 'tests/screenshots/reserved-files.png', fullPage: true });
});

test('reserved files: exempt from the missing-type flag', async ({ page }) => {
  await page.goto('/');

  // log.md frontmatter has `type: log`, but the exemption must hold even with no
  // type. Open the root log.md via its affordance.
  await page.getByTestId('root-reserved').locator('[data-reserved-path="log.md"]').click();
  await expect(page.getByTestId('properties')).toBeVisible();
  // No missing-type flag on a reserved file.
  await expect(page.getByTestId('type-missing')).toHaveCount(0);

  // Strip the frontmatter entirely from a reserved file and reopen: still no
  // flag, no crash (a reserved file with NO frontmatter is valid).
  await page.evaluate(() => {
    const fake = (window as unknown as {
      __emeraldFake: { simulateExternalChange: (k: string, p: string, c?: string) => void };
    }).__emeraldFake;
    fake.simulateExternalChange('modified', 'log.md', '# Just a heading\n');
  });
  await expect.poll(async () => page.getByTestId('type-missing').count()).toBe(0);
  await expect(page.getByTestId('properties')).toBeVisible();
});

test('reserved files: right-click a folder offers to create the missing one', async ({
  page,
}) => {
  await page.goto('/');

  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // concepts/ has index.md but NOT log.md -> only "Create log.md" is offered.
  await openRowMenu(page, 'concepts');
  const menu = page.getByTestId('context-menu');
  await expect(menu.locator('[data-action="createReserved:log"]')).toBeVisible();
  await expect(menu.locator('[data-action="createReserved:index"]')).toHaveCount(0);

  // Create it.
  await menu.locator('[data-action="createReserved:log"]').click();

  // It must NOT appear as an ordinary leaf, but as an affordance on concepts/.
  await expect(tree.locator('[data-path="concepts/log.md"]')).toHaveCount(0);
  await expect(
    tree.locator('[data-reserved-path="concepts/log.md"]'),
  ).toHaveCount(1);

  // Created reserved file opened and is NOT flagged for a missing type.
  await expect(page.getByTestId('properties')).toBeVisible();
  await expect(page.getByTestId('type-missing')).toHaveCount(0);

  // The created log.md has a minimal stub (a heading), no `type` field.
  const content = await page.evaluate(
    () =>
      (window as unknown as { __emeraldFake: { files: Record<string, string> } })
        .__emeraldFake.files['concepts/log.md'],
  );
  expect(content).toContain('#');
  expect(content).not.toContain('type:');

  // A folder with NEITHER (concepts/editor/) offers BOTH create actions.
  await openRowMenu(page, 'concepts/editor');
  const menu2 = page.getByTestId('context-menu');
  await expect(menu2.locator('[data-action="createReserved:index"]')).toBeVisible();
  await expect(menu2.locator('[data-action="createReserved:log"]')).toBeVisible();
});
