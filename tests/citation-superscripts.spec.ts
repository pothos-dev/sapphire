import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Slice: citation-superscripts.
 *
 * Inline `[n]` citation references that follow a word render as superscript,
 * clickable links (`.cm-citation-ref`) in the live-preview editor; clicking one
 * scrolls to the matching `[n]` row of the citation table and flashes it
 * (`.cm-citation-target`). The table rows themselves stay literal `[n]` text —
 * never superscript. Driven against the fake backend.
 */

type FakeWindow = Window & {
  __sapphireFake: {
    simulateExternalChange: (kind: string, path: string, content?: string) => void;
    files: Record<string, string>;
  };
};

const fm = (title: string) => `---\ntype: concept\ntitle: ${title}\n---\n\n`;

async function createConcept(page: Page, path: string, body: string): Promise<void> {
  await page.waitForFunction(() => '__sapphireFake' in window);
  await page.evaluate(
    ([p, b]) => {
      (window as unknown as FakeWindow).__sapphireFake.simulateExternalChange('created', p, b);
    },
    [path, body] as const,
  );
}

// A body with a run of inline references and a citation table lower down. Blank
// lines pad the table well below the fold so a jump has to scroll.
const BODY =
  `${fm('Kokumi')}# Kokumi\n\n` +
  'Kokumi peptides measurably deepen umami and body in stocks and consommés.[6][7][8]\n\n' +
  `${'Filler paragraph to push the table down.\n\n'.repeat(30)}` +
  '# Citations\n\n' +
  '[6] Kokumi as a mouthfulness-enhancing taste modifier.\n' +
  '[7] CaSR mechanism and γ-glutamyl peptide agonists.\n' +
  '[8] Cryo-EM structure of CaSR bound to γ-Glu-Val-Gly.\n';

async function openKokumi(page: Page) {
  await page.goto('/');
  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();
  await createConcept(page, 'kokumi.md', BODY);
  await expect(tree.locator('[data-path="kokumi.md"]')).toBeVisible();
  await tree.locator('[data-path="kokumi.md"]').click();
  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Kokumi peptides');
  return editor;
}

test('inline references render as superscript links; table rows stay literal', async ({ page }) => {
  const editor = await openKokumi(page);

  // Three superscript references, one per number, in document order. The `[n]`
  // brackets are kept around the clickable number.
  const refs = editor.locator('.cm-citation-ref');
  await expect(refs).toHaveCount(3);
  await expect(refs.nth(0)).toHaveText('[6]');
  await expect(refs.nth(1)).toHaveText('[7]');
  await expect(refs.nth(2)).toHaveText('[8]');
  // They are actual <sup> elements.
  await expect(refs.first()).toHaveJSProperty('tagName', 'SUP');

  // On the reference line, the three raw source tokens are replaced by the
  // bracketed superscript widgets — no bare `[6]` source text remains.
  const refLine = editor.locator('.cm-line', { hasText: 'consommés' }).first();
  await expect(refLine.locator('.cm-citation-ref')).toHaveCount(3);

  // The table is virtualized off-screen; jump to it via the reference, then
  // assert the row keeps its literal `[6]` and is NOT rendered as a superscript.
  await refs.nth(0).click();
  const defLine = editor.locator('.cm-line', { hasText: 'mouthfulness-enhancing' }).first();
  await expect(defLine).toBeInViewport();
  await expect(defLine).toContainText('[6]');
  await expect(defLine.locator('.cm-citation-ref')).toHaveCount(0);
});

test('clicking a reference scrolls to its table row and flashes it', async ({ page }) => {
  const editor = await openKokumi(page);

  // The `[7]` row starts off-screen (below 30 filler paragraphs).
  const defLine = editor.locator('.cm-line', { hasText: 'CaSR mechanism' }).first();

  await editor.locator('.cm-citation-ref', { hasText: '7' }).click();

  // The jump flashes the target row and brings it into view.
  await expect(editor.locator('.cm-citation-target')).toBeVisible();
  await expect(defLine).toBeInViewport();
});
