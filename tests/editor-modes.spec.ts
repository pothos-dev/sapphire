import { test, expect } from './fixtures';

/**
 * Tri-state editor mode toggle (Obsidian parity): Source / Live / Reading.
 *
 * Drives the header segmented control against the fake backend's rich Concept
 * and asserts each mode's defining behaviour:
 *  - Live (hybrid, default): inactive lines render styled; the cursor line
 *    reveals raw markup; the document is editable.
 *  - Source: no live-preview decorations — the raw `#`/`**` markup is visible
 *    on every line without moving the cursor; still editable.
 *  - Reading: every line renders (no raw markup even on the clicked line) and
 *    the document is read-only.
 * Switching mode reconfigures the view in place (no rebuild), so the document
 * survives the round-trip.
 */
test('editor modes: Source / Live / Reading toggle changes render + editability', async ({
  page,
}) => {
  await page.goto('/');

  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();
  await tree.locator('[data-path="concepts/editor/live-preview.md"]').click();

  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Obsidian-style hybrid editing');

  const content = editor.locator('.cm-content');
  const h1 = editor.locator('.cm-atomic-h1');
  const sourceBtn = page.getByTestId('editor-mode-edit');
  const liveBtn = page.getByTestId('editor-mode-hybrid');
  const readBtn = page.getByTestId('editor-mode-view');

  // --- Live (hybrid) is the default ---------------------------------------
  await expect(liveBtn).toHaveAttribute('aria-pressed', 'true');
  // Heading renders styled (live-preview line decoration) and the bare `#`
  // marker is hidden on the inactive line, so the literal `# ` is not present.
  await expect(h1.first()).toBeVisible();
  await expect(editor).not.toContainText('# Live Preview');
  await expect(content).toHaveAttribute('contenteditable', 'true');

  // --- Source mode: raw markup everywhere, no decorations -----------------
  await sourceBtn.click();
  await expect(sourceBtn).toHaveAttribute('aria-pressed', 'true');
  // The live-preview line decoration is gone (no `.cm-atomic-h1`)...
  await expect(h1).toHaveCount(0);
  // ...and the raw `# Live Preview` markup is visible WITHOUT clicking the line.
  await expect(editor).toContainText('# Live Preview');
  // Source mode is still editable.
  await expect(content).toHaveAttribute('contenteditable', 'true');

  // --- Reading mode: fully rendered + read-only ---------------------------
  await readBtn.click();
  await expect(readBtn).toHaveAttribute('aria-pressed', 'true');
  // Decorations are back (heading renders) and the read-only facet is applied.
  await expect(h1.first()).toBeVisible();
  await expect(content).toHaveAttribute('contenteditable', 'false');
  // The defining difference from Live: clicking the heading does NOT reveal its
  // raw markup — reading view ignores the cursor (atomic-editor `alwaysRender`).
  await h1.first().click();
  await expect(editor).not.toContainText('# Live Preview');

  // --- Back to Live: hybrid reveal-on-cursor restored ---------------------
  await liveBtn.click();
  await expect(content).toHaveAttribute('contenteditable', 'true');
  await h1.first().click();
  const activeLine = editor.locator('.cm-activeLine').first();
  await expect(activeLine).toContainText('# Live Preview');
});

/**
 * The chosen mode is persisted per-Bundle and restored on relaunch
 * (persist-editor-mode): pick Reading, reload the app, and the restored Concept
 * opens in Reading mode (read-only, no rebuild-back-to-default).
 */
test('editor modes: chosen mode persists across a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tree')).toBeVisible();

  // The fake backend is localStorage-backed and (under the shared CDP browser)
  // survives across runs, so clear it and reload to boot from a clean session.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();
  await tree.locator('[data-path="concepts/editor/live-preview.md"]').click();

  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();

  // Switch to Reading and confirm it took.
  await page.getByTestId('editor-mode-view').click();
  await expect(page.getByTestId('editor-mode-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');

  // Wait for the debounced save to flush both the open Concept and the mode to
  // localStorage before reloading (the reload restores exactly what's persisted).
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('sapphire:bundleState:/fake/bundle');
        if (raw === null) return null;
        return JSON.parse(raw) as { lastOpenConcept: string | null; editorMode?: string };
      }),
    )
    .toMatchObject({ lastOpenConcept: 'concepts/editor/live-preview.md', editorMode: 'view' });

  // Reload: the last-open Concept reopens and should be in Reading mode again.
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('editor-mode-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
});

/**
 * The mode toggle is disabled until a Concept is open (mode is meaningless with
 * no document), and enables once one is.
 */
test('editor modes: toggle is disabled until a Concept is open', async ({ page }) => {
  await page.goto('/');

  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  const liveBtn = page.getByTestId('editor-mode-hybrid');
  await expect(liveBtn).toBeDisabled();

  await tree.locator('[data-path="concepts/editor/live-preview.md"]').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(liveBtn).toBeEnabled();
});
