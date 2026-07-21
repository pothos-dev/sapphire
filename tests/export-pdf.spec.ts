import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Export as PDF → print/PDF preview window (Layer 3).
 *
 * The desktop reading view is CodeMirror (virtualized), so it can't be printed
 * directly. The Export-as-PDF button (and Ctrl+P) now open a SEPARATE, chrome-
 * free print/PDF preview in its own window/tab (`backend.openPrintWindow`),
 * which renders the open Concept via `backend.renderConcept` and offers reader
 * controls (font size, margins) plus Print / Save-as-PDF — so the PDF can be
 * inspected before saving. On the desktop this is a native window; under the
 * fake backend (Chromium/Playwright) it is a new tab at `/?print=<path>&toolbar=1`.
 *
 * Two surfaces exercised:
 *   - the desktop shell opens the preview WITH the reader toolbar (`toolbar=1`);
 *   - the preview itself (`PrintView`) rendered directly for a fixture Concept:
 *     toolbar variant (controls + Print button) and the bare web variant (no
 *     toolbar, auto-invokes the browser's print → Save-as-PDF preview).
 *
 * `window.print` is stubbed via `addInitScript` (headless Chromium has no print
 * dialog); the stub just records a call count.
 */

type FakeWindow = Window & {
  __sapphireFake: {
    simulateExternalChange: (kind: string, path: string, content?: string) => void;
    files: Record<string, string>;
  };
};

const fm = (title: string) => `---\ntype: concept\ntitle: ${title}\n---\n\n`;

const BODY = `# Export Me\n\nAn ordinary paragraph.\n`;

// A Concept that already lives in the seeded fake Bundle (so a freshly-loaded
// preview tab can render it), carrying CriticMarkup to prove the shared render.
const FIXTURE = 'concepts/annotated.md';

async function stubPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __printCalls: number }).__printCalls = 0;
    window.print = () => {
      (window as unknown as { __printCalls: number }).__printCalls += 1;
    };
  });
}

async function printCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls ?? 0);
}

async function createConcept(page: Page, path: string, body: string): Promise<void> {
  await page.waitForFunction(() => '__sapphireFake' in window);
  await page.evaluate(
    ([p, b]) => {
      (window as unknown as FakeWindow).__sapphireFake.simulateExternalChange('created', p, b);
    },
    [path, body] as const,
  );
}

async function openConcept(page: Page, path: string, body: string) {
  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();
  await createConcept(page, path, body);
  await expect(tree.locator(`[data-path="${path}"]`)).toBeVisible();
  await tree.locator(`[data-path="${path}"]`).click();
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  return editor;
}

test('export button is disabled with no Concept open and enabled once one is', async ({
  page,
}) => {
  await page.goto('/');

  const exportBtn = page.getByTestId('export-pdf');
  await expect(exportBtn).toBeVisible();
  // Nothing open on a fresh Bundle → the export affordance is disabled.
  await expect(exportBtn).toBeDisabled();

  await openConcept(page, 'export-me.md', `${fm('Export Me')}${BODY}`);
  await expect(exportBtn).toBeEnabled();
});

test('clicking Export opens the print preview window for the open Concept', async ({ page }) => {
  await page.goto('/');
  await openConcept(page, 'export-me.md', `${fm('Export Me')}${BODY}`);

  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('export-pdf').click();
  const popup = await popupPromise;

  // Opened the chrome-free preview for THIS Concept, with the desktop toolbar.
  expect(popup.url()).toContain('print=export-me.md');
  expect(popup.url()).toContain('toolbar=1');
});

test('Ctrl+P opens the print preview window (not the native print)', async ({ page }) => {
  await page.goto('/');
  await openConcept(page, 'export-me.md', `${fm('Export Me')}${BODY}`);

  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('ControlOrMeta+p');
  const popup = await popupPromise;

  expect(popup.url()).toContain('print=export-me.md');
  expect(popup.url()).toContain('toolbar=1');
});

test('preview (toolbar) renders the Concept and Print calls window.print', async ({ page }) => {
  await stubPrint(page);
  await page.goto(`/?print=${encodeURIComponent(FIXTURE)}&toolbar=1`);

  // The rendered body: the fixture heading + a CriticMarkup highlight (the fake
  // render emits the same `critic-*` HTML the Rust renderer does).
  const body = page.getByTestId('print-body');
  await expect(body.locator('h1')).toContainText('Annotated');
  await expect(body.locator('.critic-highlight')).toContainText('pre-existing');

  // Reader controls are present: a direct Save-as-PDF button, a Print… button
  // (drives window.print once), and the margin selector.
  await expect(page.getByTestId('save-pdf')).toBeEnabled();
  await expect(page.getByTestId('margin-select')).toBeVisible();
  const printAction = page.getByTestId('print-action');
  await expect(printAction).toBeEnabled();
  await printAction.click();
  await expect.poll(() => printCalls(page)).toBe(1);

  // Font controls adjust the displayed size.
  await expect(page.getByTestId('font-size')).toHaveText('16px');
  await page.getByTestId('font-inc').click();
  await expect(page.getByTestId('font-size')).toHaveText('17px');

  await page.screenshot({ path: 'tests/screenshots/export-pdf.png', fullPage: true });
});

test('preview (web, no toolbar) renders and auto-invokes the browser print', async ({ page }) => {
  await stubPrint(page);
  await page.goto(`/?print=${encodeURIComponent(FIXTURE)}`);

  // No reader toolbar — the browser's native print → Save-as-PDF UI is used.
  await expect(page.getByTestId('print-body').locator('h1')).toContainText('Annotated');
  await expect(page.getByTestId('print-action')).toHaveCount(0);

  // The bare tab hands straight to the browser's print preview on load.
  await expect.poll(() => printCalls(page)).toBe(1);
});
