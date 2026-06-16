import { test, expect } from '@playwright/test';

test('walking skeleton: tree renders and a Concept opens', async ({ page }) => {
  await page.goto('/');

  // The Bundle tree renders (fake backend fixture).
  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // A known fixture file is present in the tree.
  await expect(tree.getByText('index.md', { exact: true }).first()).toBeVisible();

  // Open a Concept by clicking its tree entry.
  await tree.locator('[data-path="concepts/codemirror.md"]').click();

  // Its content shows in the CM6 editor.
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('CodeMirror 6 is the editor core');

  // The editor became editable in the editing-autosave-watcher slice (that
  // slice's spec asserts editability + autosave); here we just confirm a
  // Concept renders.
  const editable = await editor.locator('.cm-content').getAttribute('contenteditable');
  expect(editable).toBe('true');

  await page.screenshot({ path: 'tests/screenshots/walking-skeleton.png', fullPage: true });
});
