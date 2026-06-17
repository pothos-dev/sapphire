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

/** Open the context menu for a tree node by right-clicking its row. */
async function openRowMenu(page: Page, path: string) {
  const tree = page.getByTestId('tree');
  await tree.locator(`[data-row-path="${path}"]`).click({ button: 'right' });
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
  // It opens body-only — reserved files hide the Properties panel entirely
  // (slice: hide-properties-for-reserved-files). The body still renders.
  await expect(page.getByTestId('properties')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toContainText('Knowledge Base');

  // --- Subfolder affordance: concepts/ has index.md surfaced on its folder row ---
  await expect(
    tree.locator('[data-reserved-path="concepts/index.md"]'),
  ).toHaveCount(1);
  await tree.locator('[data-reserved-path="concepts/index.md"]').click({ force: true });
  await expect(page.getByTestId('properties')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toContainText('Concepts');

  await page.screenshot({ path: 'tests/screenshots/reserved-files.png', fullPage: true });
});

test('reserved files: no Properties panel, body editing still works', async ({ page }) => {
  await page.goto('/');

  // Open the root log.md via its affordance — body only, no Properties panel
  // (slice: hide-properties-for-reserved-files).
  await page.getByTestId('root-reserved').locator('[data-reserved-path="log.md"]').click();
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('properties')).toHaveCount(0);

  // The body remains fully editable and autosaves to the backend.
  const content = editor.locator('.cm-content');
  await expect(content).toHaveAttribute('contenteditable', 'true');
  const marker = 'RESERVED_BODY_MARKER';
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`\n\n${marker}`);
  await expect
    .poll(async () =>
      page.evaluate(
        (m) =>
          (window as unknown as { __emeraldFake: { files: Record<string, string> } })
            .__emeraldFake.files['log.md'].includes(m),
        marker,
      ),
    )
    .toBe(true);

  // Stripping the frontmatter entirely keeps the panel hidden (no crash).
  await page.evaluate(() => {
    const fake = (window as unknown as {
      __emeraldFake: { simulateExternalChange: (k: string, p: string, c?: string) => void };
    }).__emeraldFake;
    fake.simulateExternalChange('modified', 'log.md', '# Just a heading\n');
  });
  await expect(editor).toContainText('Just a heading');
  await expect(page.getByTestId('properties')).toHaveCount(0);

  // A normal Concept STILL shows the Properties panel.
  await page.getByTestId('tree').locator('[data-path="concepts/bundle.md"]').click();
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

  // Created reserved file opened body-only — no Properties panel.
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('properties')).toHaveCount(0);

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
