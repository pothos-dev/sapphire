import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Slice: criticmarkup-annotations (feat/criticmarkup-annotations).
 *
 * Drives the CriticMarkup highlight+comment authoring flow against the fake
 * backend and asserts the user-visible behaviour:
 *
 *  - AUTHORING: with a selection, `Control/Cmd+Alt+m` wraps it as a
 *    `{==sel==}{>><<}` annotation and parks the caret in the empty comment; the
 *    typed note is stored in the comment. Moving the caret away COLLAPSES the
 *    annotation: the raw `{==`/`{>>` delimiters are hidden, the highlighted text
 *    keeps its `.cm-critic-highlight` background, and a `.cm-critic-gutter-icon`
 *    appears in the left gutter.
 *  - HOVER: hovering the highlighted text surfaces the note in a
 *    `.cm-critic-tooltip`.
 *
 * It also produces the light + dark README screenshots (an "implementation plan"
 * document with three margin comments and one tooltip open). Those are NOT test
 * artifacts (those live under tests/screenshots/) — they are committed marketing
 * assets, so they are written to docs/assets/. Theme follows the OS color scheme
 * (theme.svelte.ts), so each mode is driven via the browser context's
 * `colorScheme` and asserted against the app root's `data-theme` before snapping.
 *
 * Fixtures are seeded at RUNTIME via the fake watcher hook (NOT by editing the
 * shared fixture module), so the Explorer tree other specs screenshot is left
 * untouched — same approach as wikilinks.spec.ts.
 */

const ASSET_DIR = 'docs/assets';

type FakeWindow = Window & {
  __sapphireFake: {
    simulateExternalChange: (kind: string, path: string, content?: string) => void;
    files: Record<string, string>;
  };
};

const fm = (title: string) => `---\ntype: concept\ntitle: ${title}\n---\n\n`;

/** Create a Concept at a bundle-relative path via the fake watcher hook. */
async function createConcept(page: Page, path: string, body: string): Promise<void> {
  await page.evaluate(
    ([p, b]) => {
      (window as unknown as FakeWindow).__sapphireFake.simulateExternalChange('created', p, b);
    },
    [path, body] as const,
  );
}

test.beforeAll(() => {
  mkdirSync(ASSET_DIR, { recursive: true });
});

test('authoring: Ctrl+Alt+m wraps a selection into a collapsed highlight+comment annotation', async ({
  page,
}) => {
  await page.goto('/');
  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  // A single-word paragraph makes the keyboard selection deterministic.
  await createConcept(
    page,
    'critic-author.md',
    `${fm('Critic Author')}# Critic Author\n\nHighlightme is the word to annotate.\n`,
  );
  await expect(tree.locator('[data-path="critic-author.md"]')).toBeVisible();
  await tree.locator('[data-path="critic-author.md"]').click();

  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Highlightme is the word');

  // Select the leading word "Highlightme" with the keyboard: click into the
  // paragraph line, go to its start, then extend the selection over the word.
  const para = editor.locator('.cm-line', { hasText: 'Highlightme' }).first();
  await para.click();
  await page.keyboard.press('Home');
  // "Highlightme" is 11 characters.
  for (let i = 0; i < 11; i++) await page.keyboard.press('Shift+ArrowRight');

  // Toggle the annotation over the selection (Ctrl on Linux/Windows, Cmd on mac).
  await page.keyboard.press('ControlOrMeta+Alt+m');

  // The caret is parked inside the empty comment — type the note directly.
  await page.keyboard.type('Needs a citation to the style guide');

  // Move the caret out of the annotation so it COLLAPSES (delimiters hidden).
  await page.keyboard.press('ControlOrMeta+End');

  // --- The authoring path produced a rendered highlight -------------------
  const highlight = editor.locator('.cm-critic-highlight').first();
  await expect(highlight).toBeVisible();
  await expect(highlight).toHaveText('Highlightme');

  // --- Collapsed: the raw CriticMarkup delimiters are NOT in the rendered DOM
  await expect(editor).not.toContainText('{==');
  await expect(editor).not.toContainText('{>>');
  await expect(editor).not.toContainText('==}');

  // --- A comment gutter icon marks the annotated line ---------------------
  await expect(editor.locator('.cm-critic-gutter-icon').first()).toBeVisible();

  // --- Hover the highlight → the note surfaces in a tooltip ---------------
  await highlight.hover();
  const tooltip = page.locator('.cm-critic-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Needs a citation to the style guide');

  // Sanity: the on-disk source DID get the CriticMarkup wrapping (the hidden
  // markup is real, just not rendered) — proves the authoring command wrote it.
  const source = await page.evaluate(
    () => (window as unknown as FakeWindow).__sapphireFake.files['critic-author.md'],
  );
  expect(source).toContain('{==Highlightme==}{>>Needs a citation to the style guide<<}');
});

test('right-click menu: "Add comment" wraps the selection into an annotation', async ({
  page,
}) => {
  await page.goto('/');
  const tree = page.getByTestId('tree');
  await expect(tree).toBeVisible();

  await createConcept(
    page,
    'critic-menu.md',
    `${fm('Critic Menu')}# Critic Menu\n\nHighlightme is the word to annotate.\n`,
  );
  await expect(tree.locator('[data-path="critic-menu.md"]')).toBeVisible();
  await tree.locator('[data-path="critic-menu.md"]').click();

  const editor = page.getByTestId('editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Highlightme is the word');

  // Select "Highlightme" with the keyboard (same deterministic approach as the
  // authoring test), then open the annotate menu WITHOUT disturbing the
  // selection: a synthetic `contextmenu` event preserves it (a real right-click
  // could collapse the selection to the click point).
  const para = editor.locator('.cm-line', { hasText: 'Highlightme' }).first();
  await para.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 11; i++) await page.keyboard.press('Shift+ArrowRight');

  await editor.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 });

  // The menu offers the contextual "Add comment" item (a selection is present).
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-action="annotate"]')).toHaveText('Add comment');

  await menu.locator('[data-action="annotate"]').click();

  // The menu closed and the selection was wrapped as an annotation; the caret is
  // parked inside the (empty) comment. The highlight mark covers the content even
  // while revealed, so it is present with the selected word.
  await expect(menu).toHaveCount(0);
  await expect(editor.locator('.cm-critic-highlight').first()).toHaveText('Highlightme');

  const source = await page.evaluate(
    () => (window as unknown as FakeWindow).__sapphireFake.files['critic-menu.md'],
  );
  expect(source).toContain('{==Highlightme==}{>><<}');
});

// A realistic "implementation plan" document: three highlighted phrases, each
// with an adjacent margin comment (rendered as a left-gutter icon + hover note).
const PLAN_BODY =
  `${fm('Implementation Plan')}# Implementation Plan — Payments Service\n\n` +
  `A living plan for the payments rebuild. Reviewer notes are attached inline as\n` +
  `margin comments — hover a highlight to read the note.\n\n` +
  `## Milestone 1 — Foundations\n\n` +
  `We will {==stand up the billing gateway==}{>>Blocked on the vendor sandbox ` +
  `credentials — chasing Priya this week<<} before wiring any checkout flows to it.\n\n` +
  `\n` +
  `The domain model must {==treat currency as an explicit value object==}{>>No ` +
  `floating point: store minor units as integers to avoid rounding drift<<} across ` +
  `every service boundary.\n\n` +
  `## Milestone 2 — Rollout\n\n` +
  `Ship the new flow behind a {==staged feature flag==}{>>Start at 5% of traffic ` +
  `and ramp daily while we watch the error budget<<} so the rollout stays reversible.\n`;

for (const scheme of ['light', 'dark'] as const) {
  test(`README screenshot — annotations, ${scheme} mode`, async ({ browser }) => {
    const context = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 1280, height: 860 },
    });
    const page = await context.newPage();

    await page.goto('/');
    const tree = page.getByTestId('tree');
    await expect(tree).toBeVisible();
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-theme', scheme);

    await createConcept(page, 'implementation-plan.md', PLAN_BODY);
    await expect(tree.locator('[data-path="implementation-plan.md"]')).toBeVisible();
    await tree.locator('[data-path="implementation-plan.md"]').click();

    const editor = page.getByTestId('editor');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('Implementation Plan');

    // All three annotations render collapsed (no cursor inside any of them, since
    // we never focus the editor — keeping the shot free of a blinking caret).
    await expect(editor.locator('.cm-critic-highlight')).toHaveCount(3);
    await expect(editor.locator('.cm-critic-gutter-icon').first()).toBeVisible();

    // The money shot: hover the middle highlight so its note tooltip is open.
    const money = editor
      .locator('.cm-critic-highlight', { hasText: 'treat currency as an explicit value object' })
      .first();
    await money.hover();
    const tooltip = page.locator('.cm-critic-tooltip');
    await expect(tooltip).toBeVisible();

    // Let fonts/tooltip settle for a crisp frame.
    await page.waitForTimeout(300);

    await page.screenshot({ path: `${ASSET_DIR}/annotations-${scheme}.png`, fullPage: false });

    await context.close();
  });
}
