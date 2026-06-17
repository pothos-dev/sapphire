import { test, expect, type Page } from '@playwright/test';

/**
 * Slice: add-property-text-or-list.
 *
 * Drives the Properties panel's add controls against the fake backend:
 *  - `[+ Text]` adds a focused, empty scalar row,
 *  - `[+ List]` adds an empty chip-list row,
 *  - committing a valid key persists the new property with the correct KIND,
 *  - blurring a new row with an empty key DISCARDS it (nothing written),
 *  - a duplicate key on a new row is rejected (row discarded, no write under
 *    the duplicate name),
 *  - adding the first property to a frontmatter-less doc synthesizes a valid
 *    `---…---` block.
 */

/** Read the persisted raw markdown of a Concept from the fake backend. */
function persisted(page: Page, path: string): Promise<string> {
  return page.evaluate(
    (p) =>
      (
        window as unknown as { __emeraldFake: { files: Record<string, string> } }
      ).__emeraldFake.files[p],
    path,
  );
}

/** Open a Concept and wait for the Properties panel to render. */
async function open(page: Page, path: string) {
  await page.goto('/');
  await expect(page.getByTestId('tree')).toBeVisible();
  await page.locator(`[data-path="${path}"]`).click();
  await expect(page.getByTestId('properties')).toBeVisible();
}

test('properties: [+ Text] adds a focused empty scalar, commits with scalar kind', async ({
  page,
}) => {
  await open(page, 'concepts/codemirror.md');

  await page.getByTestId('add-text').click();

  // New row's key input is focused and empty (it has key '' -> testid `key-`).
  const newKey = page.getByTestId('key-');
  await expect(newKey).toBeFocused();
  await expect(newKey).toHaveValue('');

  // Commit a valid key. It persists as a scalar (`key:` with empty value).
  await newKey.fill('status');
  await newKey.blur();

  await expect.poll(() => persisted(page, 'concepts/codemirror.md')).toContain('status:');
  const after = await persisted(page, 'concepts/codemirror.md');
  // Scalar kind: a bare `key:` line, NOT a flow-sequence `[]`.
  expect(after).toMatch(/\nstatus:\s*\n/);
  expect(after).not.toContain('status: []');
  // Existing keys untouched.
  expect(after).toContain('type: concept');
});

test('properties: [+ List] adds an empty chip row, commits with list kind', async ({
  page,
}) => {
  await open(page, 'concepts/codemirror.md');

  await page.getByTestId('add-list').click();

  const newKey = page.getByTestId('key-');
  await expect(newKey).toBeFocused();
  // The value renders as a chip container (empty, with an "Add…" input).
  await expect(page.getByTestId('chips-')).toBeVisible();

  await newKey.fill('authors');
  await newKey.blur();

  await expect.poll(() => persisted(page, 'concepts/codemirror.md')).toContain('authors:');
  const after = await persisted(page, 'concepts/codemirror.md');
  // List kind: empty flow sequence.
  expect(after).toContain('authors: []');
});

test('properties: blurring a new row with an empty key discards it', async ({ page }) => {
  await open(page, 'concepts/codemirror.md');
  const before = await persisted(page, 'concepts/codemirror.md');

  await page.getByTestId('add-text').click();
  const newKey = page.getByTestId('key-');
  await expect(newKey).toBeFocused();

  // Blur without typing a key -> the row is discarded; nothing written.
  await newKey.blur();

  await expect(page.getByTestId('key-')).toHaveCount(0);
  expect(await persisted(page, 'concepts/codemirror.md')).toBe(before);
});

test('properties: duplicate key on a new row is rejected (discarded, no write)', async ({
  page,
}) => {
  await open(page, 'concepts/codemirror.md');
  const before = await persisted(page, 'concepts/codemirror.md');

  await page.getByTestId('add-text').click();
  const newKey = page.getByTestId('key-');
  await newKey.fill('type'); // collides with the existing `type`
  await newKey.blur();

  // Row discarded; the existing `type` is not duplicated and nothing is written.
  await expect(page.getByTestId('key-')).toHaveCount(0);
  const after = await persisted(page, 'concepts/codemirror.md');
  expect(after).toBe(before);
  // Exactly one `type:` line survives.
  expect(after.match(/\ntype:/g)?.length ?? 0).toBe(1);
});

test('properties: adding the first property to a frontmatter-less doc writes a valid block', async ({
  page,
}) => {
  await open(page, 'concepts/no-frontmatter.md');
  // No frontmatter -> the empty-state marker is shown.
  await expect(page.getByTestId('properties-empty')).toBeVisible();

  await page.getByTestId('add-text').click();
  const newKey = page.getByTestId('key-');
  await newKey.fill('type');
  await newKey.blur();

  await expect.poll(() => persisted(page, 'concepts/no-frontmatter.md')).toContain('type:');
  const after = await persisted(page, 'concepts/no-frontmatter.md');
  // A valid block was synthesized: opening + closing fences, then the body.
  expect(after.startsWith('---\n')).toBe(true);
  expect(after).toContain('\n---\n');
  expect(after).toContain('# No Frontmatter');
});
