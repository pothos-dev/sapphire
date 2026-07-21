import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Desktop Export-as-PDF (Layer 3).
 *
 * The desktop reading view is CodeMirror (virtualized), so it can't be printed
 * directly. The Export-as-PDF button (and Ctrl+P) instead render the open
 * Concept to static HTML via `backend.renderConcept`, inject it into a hidden
 * `.print-root` container styled by the shared `rendered.css`, hydrate Mermaid,
 * set the document title, and call `window.print()`.
 *
 * Drives it over the fake backend (whose `renderConcept` emits CriticMarkup to
 * the SAME `critic-*` classes the Rust renderer uses). Asserts:
 *   - the export button is DISABLED with no Concept open, ENABLED once one is;
 *   - clicking it calls `window.print()` AND fills `.print-root` with the
 *     rendered body (a heading + a `.critic-add` mark from the fixture);
 *   - Ctrl+P routes through the same export flow.
 *
 * Uses the runtime fake-watcher seed hook (like critic-changes.spec.ts) so the
 * shared Explorer tree other specs screenshot is left untouched. `window.print`
 * is stubbed via `addInitScript` (headless Chromium has no print dialog) — the
 * stub records call count and does NOT fire `afterprint`, so the injected body
 * survives for inspection.
 */

type FakeWindow = Window & {
  __sapphireFake: {
    simulateExternalChange: (kind: string, path: string, content?: string) => void;
    files: Record<string, string>;
  };
};

const fm = (title: string) => `---\ntype: concept\ntitle: ${title}\n---\n\n`;

const BODY =
  `# Export Me\n\n` +
  `An {++inserted++} phrase and a {--removed--} phrase.\n`;

async function stubPrint(page: Page): Promise<void> {
  // Record print calls on the window; suppress the (nonexistent, headless) dialog
  // and deliberately do NOT dispatch `afterprint`, so the print body stays put.
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
  await stubPrint(page);
  await page.goto('/');

  const exportBtn = page.getByTestId('export-pdf');
  await expect(exportBtn).toBeVisible();
  // Nothing open on a fresh Bundle → the export affordance is disabled.
  await expect(exportBtn).toBeDisabled();

  await openConcept(page, 'export-me.md', `${fm('Export Me')}${BODY}`);
  await expect(exportBtn).toBeEnabled();
});

test('clicking Export renders the Concept body into .print-root and calls print', async ({
  page,
}) => {
  await stubPrint(page);
  await page.goto('/');
  await openConcept(page, 'export-me.md', `${fm('Export Me')}${BODY}`);

  await page.getByTestId('export-pdf').click();

  // window.print was invoked exactly once.
  await expect.poll(() => printCalls(page)).toBe(1);

  // The hidden print container now holds the rendered body: the heading and the
  // CriticMarkup addition mark (the fake render emits the same `critic-*` HTML).
  const printRoot = page.getByTestId('print-root');
  await expect(printRoot.locator('h1')).toContainText('Export Me');
  await expect(printRoot.locator('ins.critic-add')).toHaveText('inserted');
  await expect(printRoot.locator('del.critic-del')).toHaveText('removed');

  await page.screenshot({ path: 'tests/screenshots/export-pdf.png', fullPage: true });
});

test('Ctrl+P routes through the export flow (not the native print)', async ({ page }) => {
  await stubPrint(page);
  await page.goto('/');
  await openConcept(page, 'export-me.md', `${fm('Export Me')}${BODY}`);

  await page.keyboard.press('ControlOrMeta+p');

  await expect.poll(() => printCalls(page)).toBe(1);
  await expect(page.getByTestId('print-root').locator('h1')).toContainText('Export Me');
});
