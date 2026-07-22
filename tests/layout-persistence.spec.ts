import { test, expect, type Page } from './fixtures';

/**
 * Slice: multi-concept-tiling (ticket 06 — layout persistence).
 *
 * The tiled workspace survives a relaunch. This drives the fake backend
 * (localStorage-backed, so a page RELOAD restores state exactly as the real
 * backend restores from the OS config file):
 *  - arrange a 2-column layout (column 1 stacks two tiles) on THREE different
 *    Concepts, each in a different view-mode, with a chosen active tile; reload
 *    and assert the columns/tiles, per-tile Concept + mode, and active tile all
 *    come back;
 *  - an OLD single-Concept session (`lastOpenConcept` + one `editorMode`, no
 *    `layout`) migrates cleanly to a single tile in that mode.
 */

const CM = 'concepts/codemirror.md';
const BUNDLE = 'concepts/bundle.md';
const LIVE = 'concepts/editor/live-preview.md';

const CM_NEEDLE = 'CodeMirror 6 is the editor core';
const BUNDLE_NEEDLE = 'is the root folder';
const LIVE_NEEDLE = 'Obsidian-style hybrid editing';

/** Seed a deterministic starting session (two folders expanded, nothing else). */
async function bootFresh(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('tree')).toBeVisible();
  await page.evaluate(() =>
    window.localStorage.setItem(
      'sapphire:bundleState:/fake/bundle',
      JSON.stringify({ expandedFolders: ['concepts', 'concepts/editor'] }),
    ),
  );
  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();
}

test('layout persistence: a 2-column stacked layout + per-tile modes + active tile survive a reload', async ({
  page,
}) => {
  await bootFresh(page);
  const tree = page.getByTestId('tree');

  // Tile 0 (column 0): codemirror.md in Reading (view) mode.
  await tree.locator(`[data-path="${CM}"]`).click();
  await expect(page.getByTestId('editor').first()).toContainText(CM_NEEDLE);
  await page.getByTestId('pane').nth(0).getByTestId('editor-mode-view').click();

  // Split Right → column 1, tile 1 (inherits codemirror + Reading). Open
  // bundle.md there and switch it to Source (edit) mode.
  await page.getByTestId('split-right').first().click();
  await expect(page.getByTestId('editor')).toHaveCount(2);
  await page.getByTestId('pane').nth(1).locator('.cm-content').click();
  await tree.locator(`[data-path="${BUNDLE}"]`).click();
  await expect(page.getByTestId('pane').nth(1).getByTestId('editor')).toContainText(BUNDLE_NEEDLE);
  await page.getByTestId('pane').nth(1).getByTestId('editor-mode-edit').click();

  // Split Down (in column 1) → tile 2 below bundle (inherits Source from its
  // source tile). Open live-preview.md there and switch it to Live (hybrid), so
  // all three tiles hold DISTINCT modes.
  await page.getByTestId('pane').nth(1).getByTestId('split-down').click();
  await expect(page.getByTestId('editor')).toHaveCount(3);
  await page.getByTestId('pane').nth(2).locator('.cm-content').click();
  await tree.locator(`[data-path="${LIVE}"]`).click();
  await expect(page.getByTestId('pane').nth(2).getByTestId('editor')).toContainText(LIVE_NEEDLE);
  await page.getByTestId('pane').nth(2).getByTestId('editor-mode-hybrid').click();

  // Make the MIDDLE tile (bundle, column 1 top) the active one — a non-trivial
  // choice (not the last-split tile) whose restoration proves the active tile is
  // persisted.
  await page.getByTestId('pane').nth(1).locator('.cm-content').click();
  await expect(page.locator('[data-testid="pane"].pane-active')).toHaveCount(1);
  await expect(page.getByTestId('pane').nth(1)).toHaveClass(/pane-active/);

  // Wait for the debounced layout save to flush: two columns, the second with two
  // tiles, active pointing at column 1 / tile 0.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('sapphire:bundleState:/fake/bundle');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          layout?: { columns: { tiles: unknown[] }[]; active: [number, number] };
        };
        const l = parsed.layout;
        if (!l) return null;
        return {
          columns: l.columns.length,
          col1Tiles: l.columns[1]?.tiles.length,
          active: l.active,
        };
      }),
    )
    .toEqual({ columns: 2, col1Tiles: 2, active: [1, 0] });

  await page.screenshot({ path: 'tests/screenshots/layout-persistence.png', fullPage: true });

  // RELOAD: the whole workspace is reconstructed.
  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();

  // Structure: 3 tiles, one column divider (2 columns), one tile divider (the
  // stacked column).
  await expect(page.getByTestId('editor')).toHaveCount(3);
  await expect(page.getByTestId('column-divider')).toHaveCount(1);
  await expect(page.getByTestId('tile-divider')).toHaveCount(1);

  // Per-tile Concepts, in row-major order (col0, then col1 top→bottom).
  await expect(page.getByTestId('pane').nth(0).getByTestId('editor')).toContainText(CM_NEEDLE);
  await expect(page.getByTestId('pane').nth(1).getByTestId('editor')).toContainText(BUNDLE_NEEDLE);
  await expect(page.getByTestId('pane').nth(2).getByTestId('editor')).toContainText(LIVE_NEEDLE);

  // Per-tile modes are restored.
  await expect(page.getByTestId('pane').nth(0).getByTestId('editor-mode-view')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('pane').nth(0).locator('.cm-content')).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await expect(page.getByTestId('pane').nth(1).getByTestId('editor-mode-edit')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('pane').nth(2).getByTestId('editor-mode-hybrid')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The active tile (middle = bundle) is restored as the active Pane.
  await expect(page.locator('[data-testid="pane"].pane-active')).toHaveCount(1);
  await expect(page.getByTestId('pane').nth(1)).toHaveClass(/pane-active/);
});

test('layout persistence: an OLD single-Concept session migrates to one tile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tree')).toBeVisible();

  // Seed a legacy session: only lastOpenConcept + a single editorMode, NO layout.
  await page.evaluate(() =>
    window.localStorage.setItem(
      'sapphire:bundleState:/fake/bundle',
      JSON.stringify({
        lastOpenConcept: 'concepts/codemirror.md',
        editorMode: 'view',
        expandedFolders: ['concepts'],
      }),
    ),
  );
  await page.reload();
  await expect(page.getByTestId('tree')).toBeVisible();

  // Migrates to a SINGLE tile showing that Concept in that mode — no dividers.
  await expect(page.getByTestId('editor')).toHaveCount(1);
  await expect(page.getByTestId('column-divider')).toHaveCount(0);
  await expect(page.getByTestId('tile-divider')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toContainText(CM_NEEDLE);
  await expect(page.getByTestId('editor-mode-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
});
