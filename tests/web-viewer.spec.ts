import { writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';

/** A scratch Concept written into the fixture Bundle to trigger live reload. */
const LIVE_NOTE = resolve('tests/fixtures/web-bundle/live-note.md');

/**
 * The read-only "Sapphire Web" viewer with SERVER-SIDE RENDER
 * (slices: web-readonly-api-walking-skeleton + web-server-side-render).
 *
 * Drives the SSR'd web shell (adapter-node) against the read-only HTTP backend
 * (`sapphire-server` over the `tests/fixtures/web-bundle` fixture, proxied
 * through `/api`). Asserts:
 *   - the Explorer tree is server-rendered and present,
 *   - opening a Concept shows RENDERED HTML (headings/paragraphs) + a read-only
 *     Properties view (frontmatter), NOT raw markdown / CodeMirror,
 *   - a broken in-Bundle link is present but styled distinct (`.broken`),
 *   - clicking a resolved in-Bundle link navigates WITHIN the viewer (URL
 *     changes, the target renders) — no browser navigation away,
 *   - NO create/rename/delete/edit affordances exist anywhere.
 * Saves a screenshot to tests/screenshots/web-viewer.png.
 */
test('web viewer renders a Concept read-only with resolved + broken links', async ({ page }) => {
  await page.goto('/');

  // The web viewer shell (not the desktop <App/>) with a server-rendered tree.
  await expect(page.getByTestId('web-viewer')).toBeVisible();
  await expect(page.getByTestId('web-tree')).toBeVisible();
  expect(await page.getByTestId('tree-concept').count()).toBeGreaterThan(0);

  // Open the root index Concept via its header affordance (index.md is a
  // reserved file, not an ordinary tree row — mirrors desktop).
  await page.locator('[data-reserved-path="index.md"]').click();
  await expect(page).toHaveURL(/\?path=index\.md/);

  // RENDERED output (not raw markdown): real heading + paragraph elements.
  const rendered = page.getByTestId('rendered');
  await expect(rendered.locator('h1')).toContainText('Web Bundle Home');
  await expect(rendered.locator('p').first()).toBeVisible();

  // Read-only Properties view from frontmatter.
  await expect(page.getByTestId('properties')).toContainText('Web Bundle Home');

  // A broken in-Bundle link is present but visually distinct.
  await expect(rendered.locator('a.internal-link.broken')).toHaveCount(2); // missing.md + [[nope-wiki]]

  // A resolved in-Bundle link exists and navigates WITHIN the viewer.
  const good = rendered.locator('a.internal-link:not(.broken)').first();
  await expect(good).toHaveAttribute('data-path', 'good.md');

  await page.screenshot({ path: 'tests/screenshots/web-viewer.png', fullPage: true });

  await good.click();
  await expect(page).toHaveURL(/\?path=good\.md/);
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Good Concept');

  // No write affordances anywhere in the read-only web build.
  await expect(page.getByTestId('root-new-concept')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ New…' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

/**
 * Live reload over SSE (slice: web-live-reload-sse). An EXTERNAL edit to the
 * Bundle on disk (the web app never writes) is delivered to the viewer via
 * `/api/events` and reacts: a create/delete refreshes the tree, and a modify to
 * the open Concept re-renders it — all without a manual refresh. Drives real
 * filesystem changes against the fixture Bundle the Rust server watches.
 * Saves a screenshot to tests/screenshots/web-live-reload.png.
 */
test('live reload: external filesystem changes update the viewer via SSE', async ({ page }) => {
  await rm(LIVE_NOTE, { force: true }); // clean slate

  const liveRow = page.getByTestId('tree-concept').filter({ hasText: 'live-note' });
  const heading = page.getByTestId('rendered').locator('h1');

  await page.goto('/?path=index.md');
  await expect(heading).toContainText('Web Bundle Home');
  await expect(liveRow).toHaveCount(0);

  // Let the viewer's EventSource finish subscribing on the server before the
  // first change — a broadcast only reaches already-connected subscribers, so a
  // change fired mid-connect would be missed (there is no DOM signal for "SSE
  // open", hence a short settle).
  await page.waitForTimeout(1500);

  try {
    // CREATE on disk → SSE → tree refresh (the new Concept appears).
    await writeFile(LIVE_NOTE, '# Live One\n\nfirst body\n');
    await expect(liveRow).toHaveCount(1, { timeout: 15_000 });

    // Open it; it renders.
    await liveRow.click();
    await expect(page).toHaveURL(/\?path=live-note\.md/);
    await expect(heading).toContainText('Live One');

    // MODIFY the OPEN Concept on disk → SSE → re-render without manual refresh.
    await writeFile(LIVE_NOTE, '# Live Two\n\nsecond body\n');
    await expect(heading).toContainText('Live Two', { timeout: 15_000 });

    await page.screenshot({ path: 'tests/screenshots/web-live-reload.png', fullPage: true });

    // DELETE on disk → SSE → tree refresh (the row disappears).
    await rm(LIVE_NOTE, { force: true });
    await expect(liveRow).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await rm(LIVE_NOTE, { force: true });
  }
});

/**
 * Bundle-wide full-text Search (slice: web-full-text-search). Ctrl+Shift+F opens
 * the modal; a query lists path/line/snippet hits with the match highlighted;
 * selecting a hit opens that Concept in the viewer. Saves a screenshot to
 * tests/screenshots/web-search.png.
 */
test('full-text search: Ctrl+Shift+F lists hits and opens a Concept', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('web-viewer')).toBeVisible();
  // Gate on hydration: the Tags Section renders from its onMount fetch, which
  // runs in the same hydration cycle as the viewer's Ctrl+Shift+F key listener,
  // so its presence means the listener is registered.
  await expect(page.getByTestId('tag-browser')).toBeVisible();

  // Open the Search modal.
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('search-panel')).toBeVisible();

  // A query lists hits with a highlighted snippet ("paragraph" is in the body).
  await page.getByTestId('search-input').fill('paragraph');
  const firstHit = page.getByTestId('search-item').first();
  await expect(firstHit).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('search-snippet').first().locator('mark')).toContainText(
    /paragraph/i,
  );

  await page.screenshot({ path: 'tests/screenshots/web-search.png', fullPage: true });

  // Selecting a hit opens that Concept in the viewer (and closes the modal).
  const hitPath = await firstHit.getAttribute('data-path');
  await firstHit.click();
  await expect(page).toHaveURL(new RegExp(`\\?path=${(hitPath ?? '').replace(/\./g, '\\.')}`));
  await expect(page.getByTestId('search-panel')).toHaveCount(0);
  await expect(page.getByTestId('rendered')).toBeVisible();
});

/**
 * Index-backed sidebar Sections (slice: web-index-backed-sidebars): Backlinks,
 * Tags, and Outline over the core index. Saves tests/screenshots/web-sidebars.png.
 */
test('index-backed sidebars: backlinks, tags, and outline', async ({ page }) => {
  // Open a Concept that is linked-to (index.md links to good.md) and has headings.
  await page.goto('/?path=good.md');
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Good Concept');

  // Outline lists the open Concept's headings; the rendered headings carry the
  // matching id slugs so selecting one scrolls the view.
  const outline = page.getByTestId('outline');
  await expect(outline.getByTestId('outline-entry')).toHaveCount(2);
  await expect(page.locator('[data-testid="rendered"] h1#good-concept')).toBeVisible();
  await expect(page.locator('[data-testid="rendered"] h2#details')).toBeVisible();
  await outline.getByTestId('outline-entry').filter({ hasText: 'Details' }).click();
  await expect(page.locator('[data-testid="rendered"] h2#details')).toBeInViewport();

  // Tags lists bundle tags with counts; expanding one reveals its Concepts.
  const tags = page.getByTestId('tag-browser');
  await expect(tags).toBeVisible();
  const demo = tags.getByTestId('tag').filter({ hasText: 'demo' });
  await expect(demo).toBeVisible();
  await expect(demo.getByTestId('tag-count')).toHaveText('1');
  await demo.click();
  await expect(tags.getByTestId('tag-concept').filter({ hasText: 'index' })).toBeVisible();

  // Backlinks lists inbound linkers (index.md links to good.md).
  const backlinks = page.getByTestId('backlinks');
  await expect(backlinks.getByTestId('backlink')).toHaveCount(1);
  const backlink = backlinks.getByTestId('backlink').first();
  await expect(backlink).toHaveAttribute('data-path', 'index.md');

  await page.screenshot({ path: 'tests/screenshots/web-sidebars.png', fullPage: true });

  // Selecting a backlink navigates within the viewer.
  await backlink.click();
  await expect(page).toHaveURL(/\?path=index\.md/);
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Web Bundle Home');
});

/**
 * The Tags Section is hidden entirely when the Bundle carries no tags (as on
 * desktop). Driven by mocking `/api/tags` empty at the browser network layer.
 */
test('tags section is hidden when the bundle has no tags', async ({ page }) => {
  await page.route('**/api/tags', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/');
  await expect(page.getByTestId('web-viewer')).toBeVisible();
  await expect(page.getByTestId('tag-browser')).toHaveCount(0);
});

/**
 * Mermaid Diagrams (slice: web-mermaid-diagrams). The server leaves ```mermaid
 * fences inert (`<code class="language-mermaid">`); a client-side island
 * hydrates them into rendered Diagrams. A valid diagram becomes an <svg>; a
 * malformed one degrades to an in-place error panel without breaking the page.
 * Saves tests/screenshots/web-mermaid.png.
 */
test('mermaid diagrams hydrate, and a malformed one degrades gracefully', async ({ page }) => {
  await page.goto('/?path=diagram.md');
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Diagram Concept');

  // The valid diagram hydrates into an SVG inside a mermaid container.
  await expect(
    page.locator('[data-testid="rendered"] .web-mermaid-render svg').first(),
  ).toBeVisible({ timeout: 15_000 });

  // The malformed diagram degrades to an in-place error panel …
  await expect(page.getByTestId('mermaid-error')).toBeVisible({ timeout: 15_000 });
  // … and the page is still intact (heading + body + tree present).
  await expect(page.getByTestId('rendered').locator('h1')).toBeVisible();
  await expect(page.getByTestId('rendered')).toContainText('stays intact');
  await expect(page.getByTestId('web-tree')).toBeVisible();

  await page.screenshot({ path: 'tests/screenshots/web-mermaid.png', fullPage: true });
});

/**
 * Desktop parity pass (follow-up): dark-by-default theme + toggle, an icon-less
 * collapsible Explorer with implicit index, and collapsible Accordion Sidebars.
 * Saves a DARK-mode screenshot to tests/screenshots/web-parity-shell-dark.png.
 */
test('desktop parity: dark theme + toggle, collapsible tree/index, accordion sidebars', async ({
  page,
}) => {
  // Dark by default: with a dark OS scheme and no stored choice, the app root
  // gets data-theme="dark" (CSS tokens follow the OS, not a light fallback).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const root = page.getByTestId('web-viewer');
  await expect(root).toHaveAttribute('data-theme', 'dark');

  // The header toggle flips the theme (and back).
  await page.getByTestId('theme-toggle').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  // index.md is NOT an ordinary tree row (reserved, hidden) — at the root and
  // inside the guide folder.
  await expect(page.locator('[data-testid="tree-concept"][data-path="index.md"]')).toHaveCount(0);
  await expect(
    page.locator('[data-testid="tree-concept"][data-path="guide/index.md"]'),
  ).toHaveCount(0);

  // The guide folder is a collapsible row; it opens by default (depth < 2) so
  // its ordinary child (topic.md) is visible.
  const guideDir = page.getByTestId('tree-dir').filter({ hasText: 'guide' });
  const topic = page.locator('[data-testid="tree-concept"][data-path="guide/topic.md"]');
  await expect(topic).toBeVisible();

  // Clicking the twisty collapses (children removed) then expands the folder.
  const twisty = guideDir.getByRole('button', { name: 'guide' });
  await twisty.click();
  await expect(topic).toHaveCount(0);
  await twisty.click();
  await expect(topic).toBeVisible();

  // Clicking the folder NAME opens its implicit index.md (mirrors desktop).
  await guideDir.locator('.name-toggle').click();
  await expect(page).toHaveURL(/\?path=guide%2Findex\.md/);
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Guide');

  await page.screenshot({ path: 'tests/screenshots/web-parity-shell-dark.png', fullPage: true });

  // The sidebar Sections collapse (accordion): collapsing Explorer removes the
  // tree body.
  await expect(page.getByTestId('web-tree')).toBeVisible();
  await page.getByTestId('explorer-section-header').click();
  await expect(page.getByTestId('web-tree')).toHaveCount(0);
});

/**
 * Round-2 polish: the center-pane toolbar (collapse-left / back / forward /
 * theme / collapse-right), collapsible Properties, and localStorage persistence
 * of UI state across reloads. Saves the DARK-mode parity shot to
 * tests/screenshots/web-parity-dark.png.
 */
test('polish: toolbar collapse/nav, Properties collapse, and persistence', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?path=good.md');
  await expect(page.getByTestId('web-viewer')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Good Concept');

  // Collapse-left button hides the left Sidebar; toggling restores it.
  await expect(page.getByTestId('web-tree')).toBeVisible();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('web-tree')).not.toBeVisible();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('web-tree')).toBeVisible();

  // Collapse-right button hides the right Sidebar; toggling restores it.
  await expect(page.getByTestId('outline')).toBeVisible();
  await page.getByTestId('right-sidebar-toggle').click();
  await expect(page.getByTestId('outline')).not.toBeVisible();
  await page.getByTestId('right-sidebar-toggle').click();
  await expect(page.getByTestId('outline')).toBeVisible();

  // Properties collapses (body removed) and re-expands.
  await expect(page.getByTestId('properties')).toBeVisible();
  await page.getByTestId('properties-toggle').click();
  await expect(page.getByTestId('properties')).toHaveCount(0);

  // Screenshot the DARK parity view (toolbar on centre pane, both Sidebars,
  // thin scrollbars) with Properties re-expanded.
  await page.getByTestId('properties-toggle').click();
  await expect(page.getByTestId('properties')).toBeVisible();
  await page.screenshot({ path: 'tests/screenshots/web-parity-dark.png', fullPage: true });

  // Back / forward: navigate to a sibling Concept, then step back + forward.
  await page.locator('[data-testid="tree-concept"][data-path="diagram.md"]').click();
  await expect(page).toHaveURL(/\?path=diagram\.md/);
  await page.getByTestId('nav-back').click();
  await expect(page).toHaveURL(/\?path=good\.md/);
  await page.getByTestId('nav-forward').click();
  await expect(page).toHaveURL(/\?path=diagram\.md/);

  // --- Persistence across reload ---
  await page.goto('/?path=good.md');
  // Collapse the guide folder, the Tags Section, and Properties.
  const guideDir = page.getByTestId('tree-dir').filter({ hasText: 'guide' });
  await guideDir.getByRole('button', { name: 'guide' }).click();
  await expect(
    page.locator('[data-testid="tree-concept"][data-path="guide/topic.md"]'),
  ).toHaveCount(0);
  await page.getByTestId('tags-section-header').click();
  await expect(page.getByTestId('tag-browser')).toHaveCount(0);
  await page.getByTestId('properties-toggle').click();
  await expect(page.getByTestId('properties')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Good Concept');
  // All three collapses were restored from localStorage.
  await expect(
    page.locator('[data-testid="tree-concept"][data-path="guide/topic.md"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId('tag-browser')).toHaveCount(0);
  await expect(page.getByTestId('properties')).toHaveCount(0);

  // Sidebar-collapse also persists.
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('web-tree')).not.toBeVisible();
  await page.reload();
  await expect(page.getByTestId('web-tree')).not.toBeVisible();
});
