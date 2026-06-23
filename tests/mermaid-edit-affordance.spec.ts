import { test, expect } from '@playwright/test';

/**
 * Slice: mermaid-edit-affordance (ADR-0005, options 6a+6b).
 *
 * A `block: true` replace decoration swallows its source, so there is no text to
 * click into. The widget therefore carries (hybrid only):
 *  - a hover affordance: `cursor: pointer` + a subtle "✎ edit" hint, and
 *  - a double-click handler that dispatches a selection INTO the fence range,
 *    lifting the block-replace to reveal the raw source for editing.
 * The global `edit`-mode toggle stays the always-available fallback.
 */
test('mermaid: double-clicking a diagram reveals the raw fence for editing', async ({
  page,
}) => {
  await page.goto('/');

  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();
  await tree.locator('[data-path="concepts/editor/live-preview.md"]').click();

  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();

  await editor.locator('.cm-scroller').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  const widget = editor.locator('.cm-mermaid');
  const diagram = widget.locator('svg');
  await expect(diagram).toBeVisible({ timeout: 15000 });

  // Hover affordance: the widget is marked editable (pointer cursor) in hybrid
  // and carries the edit hint.
  await expect(widget).toHaveClass(/cm-mermaid-editable/);
  await expect(widget).toHaveCSS('cursor', 'pointer');
  await expect(widget.locator('.cm-mermaid-edit-hint')).toHaveCount(1);

  // Double-click the rendered diagram: the handler drops the cursor into the
  // fence, lifting the block-replace and revealing the raw `graph TD` source.
  await diagram.dblclick();
  await expect(editor).toContainText('graph TD');

  await page.screenshot({
    path: 'tests/screenshots/mermaid-edit-affordance.png',
    fullPage: true,
  });
});

/**
 * The global `edit`-mode toggle remains the fallback: switching to Source mode
 * shows the raw fence regardless of the cursor, because the mermaid field is not
 * in the extension set at all in `edit`.
 */
test('mermaid: the edit-mode toggle still reveals the raw fence', async ({ page }) => {
  await page.goto('/');

  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();
  await tree.locator('[data-path="concepts/editor/live-preview.md"]').click();

  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();

  // Switch to Source (edit) mode — the raw markdown, including the mermaid
  // fence, is shown with no diagram widget.
  await page.getByTestId('editor-mode-edit').click();

  await editor.locator('.cm-scroller').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  await expect(editor).toContainText('graph TD');
  await expect(editor.locator('.cm-mermaid svg')).toHaveCount(0);
});
