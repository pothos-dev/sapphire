import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Slice: per-tile-header (single pane).
 *
 * The Pane grows a slim header carrying everything logically per-Pane for the
 * active Concept: the title + close, Split Right / Split Down (wired but inert
 * until tiling), undo/redo over the Pane's Document history, the review-diff
 * toggle, and Export-PDF. The global view-mode toggle (Source / Live / Reading)
 * lives in the NavBar, alongside the sidebar + Properties toggles.
 *
 * This drives the header controls end-to-end and screenshots the result.
 */

/** Read the persisted raw markdown of a Concept from the fake backend. */
function persisted(page: Page, path: string): Promise<string> {
  return page.evaluate(
    (p) =>
      (window as unknown as { __sapphireFake: { files: Record<string, string> } }).__sapphireFake
        .files[p],
    path,
  );
}

async function openCodemirror(page: Page) {
  await page.goto('/');
  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();
  await tree.locator('[data-path="concepts/codemirror.md"]').click();
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('CodeMirror 6 is the editor core');
  return editor;
}

test('pane header: title, undo/redo, review + export live in the header', async ({
  page,
}) => {
  await openCodemirror(page);

  // The header renders with a derived title (frontmatter `title`) and its
  // controls, above the editor.
  const header = page.getByTestId('pane-header');
  await expect(header).toBeVisible();
  await expect(page.getByTestId('pane-title')).toHaveText('CodeMirror');

  // The per-Pane controls all live inside the header (not the global NavBar).
  // The view-mode toggle is GLOBAL and lives in the NavBar, not here.
  await expect(header.getByTestId('editor-mode-toggle')).toHaveCount(0);
  await expect(header.getByTestId('undo')).toBeVisible();
  await expect(header.getByTestId('redo')).toBeVisible();
  await expect(header.getByTestId('review-toggle')).toBeVisible();
  await expect(header.getByTestId('export-pdf')).toBeVisible();
  await expect(header.getByTestId('split-right')).toBeVisible();
  await expect(header.getByTestId('split-down')).toBeVisible();
  await expect(header.getByTestId('nav-back')).toBeVisible();

  // --- Undo / redo act on the Pane's history (decoupled from Properties) ----
  const undoBtn = header.getByTestId('undo');
  const redoBtn = header.getByTestId('redo');
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();

  // Edit a property; the header undo enables. Properties is hidden by default
  // (global toggle) — switch it on so the frontmatter inputs are available.
  await page.getByTestId('properties-panel-toggle').click();
  const titleInput = page.getByTestId('scalar-title');
  await titleInput.fill('CodeMirror Renamed');
  await titleInput.blur();
  await expect
    .poll(() => persisted(page, 'concepts/codemirror.md'))
    .toContain('title: CodeMirror Renamed');
  await expect(undoBtn).toBeEnabled();

  // Header undo reverts; redo re-applies — proving they drive the shared history.
  await undoBtn.click();
  await expect(page.getByTestId('scalar-title')).toHaveValue('CodeMirror');
  await expect(redoBtn).toBeEnabled();
  await redoBtn.click();
  await expect(page.getByTestId('scalar-title')).toHaveValue('CodeMirror Renamed');

  // --- Review toggle (reuses existing enablement) ---------------------------
  const reviewToggle = page.getByTestId('review-toggle');
  await expect(reviewToggle).toBeEnabled();
  await reviewToggle.click();
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('review-editor')).toBeVisible();
  await reviewToggle.click();
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');

  // --- Export-PDF opens the print preview for this Concept ------------------
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('export-pdf').click();
  const popup = await popupPromise;
  expect(decodeURIComponent(popup.url())).toContain('print=concepts/codemirror.md');

  await page.screenshot({ path: 'tests/screenshots/pane-header.png', fullPage: true });
});

test('pane header: close affordance clears the Pane to the empty state', async ({ page }) => {
  await openCodemirror(page);

  const closeBtn = page.getByTestId('pane-close');
  await expect(closeBtn).toBeEnabled();
  await closeBtn.click();

  // The Pane returns to the empty "Select a Concept" placeholder; the editor is
  // hidden and the per-Concept controls disable.
  await expect(page.getByTestId('placeholder')).toBeVisible();
  await expect(page.getByTestId('pane-close')).toBeDisabled();
  await expect(page.getByTestId('editor-mode-hybrid')).toBeDisabled();
});

test('nav bar: global-only — view-mode + Properties + sidebar toggles, no per-Pane controls', async ({
  page,
}) => {
  const editor = await openCodemirror(page);

  // The global Properties toggle is present and drives the inline panel. It
  // starts OFF (default hidden): no Properties chrome in the tile.
  const propsToggle = page.getByTestId('properties-panel-toggle');
  await expect(propsToggle).toBeVisible();
  await expect(propsToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('properties')).toHaveCount(0);
  // Toggling it ON reveals the tile's frontmatter inline; OFF hides it again.
  await propsToggle.click();
  await expect(propsToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('properties')).toBeVisible();
  await propsToggle.click();
  await expect(propsToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('properties')).toHaveCount(0);

  // The global view-mode toggle lives in the NavBar and drives the active tile.
  const navBar = page.locator('nav[aria-label="Global controls"]');
  await expect(navBar).toBeVisible();
  await expect(navBar.getByTestId('editor-mode-toggle')).toBeVisible();
  const content = editor.locator('.cm-content');
  await expect(content).toHaveAttribute('contenteditable', 'true'); // Live default
  await navBar.getByTestId('editor-mode-view').click();
  await expect(navBar.getByTestId('editor-mode-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(content).toHaveAttribute('contenteditable', 'false'); // Reading = read-only
  await navBar.getByTestId('editor-mode-hybrid').click();
  await expect(content).toHaveAttribute('contenteditable', 'true');

  // The NavBar does NOT carry the per-Pane controls (they live in the header).
  await expect(navBar.getByTestId('review-toggle')).toHaveCount(0);
  await expect(navBar.getByTestId('export-pdf')).toHaveCount(0);
  await expect(navBar.getByTestId('nav-back')).toHaveCount(0);
  // Sidebar toggles remain global.
  await expect(navBar.getByTestId('sidebar-toggle')).toBeVisible();
  await expect(navBar.getByTestId('right-sidebar-toggle')).toBeVisible();
});
