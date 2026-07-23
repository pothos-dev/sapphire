import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { WEB_BUNDLE_DIR } from './web-bundle';
import { signInAsTestUser } from './web-auth';

/**
 * Web CONCURRENCY UX over REAL SSE (ticket 08 / 09): a test-authed user is
 * editing a Concept when a SECOND writer changes that same file on disk. The
 * running `sunstone-server` watcher broadcasts a `FileChange` over `/api/events`;
 * the editor island reacts by the ticket-08 rules — clean buffer → silent reload
 * + a non-blocking "updated" notice; dirty buffer → a blocking conflict modal;
 * an external delete of a dirty active Concept → the deleted-state banner.
 *
 * The "second writer" here is a plain filesystem write to the SERVED Bundle copy
 * (the temp git repo global-setup built), exactly as `web-viewer.spec.ts` drives
 * live-reload. A bare fs write carries `origin: null`, so the client treats it as
 * a genuine external change (never its own echo) — the right stimulus for all
 * three branches. Each test uses its OWN scratch Concept and cleans up, so it
 * never disturbs the Concepts the read-only `web-viewer` spec asserts on.
 */

/** Delay covering the island's EventSource subscribe (mirrors web-viewer). */
const SSE_SETTLE_MS = 1500;

/**
 * Sign in, write a scratch Concept into the served Bundle, open it, and enter
 * Edit mode with the island's SSE subscription established. Returns the mounted
 * editor locator. Caller is responsible for `rmSync(abs)` in a `finally`.
 */
async function openScratchInEdit(page: Page, rel: string, body: string) {
  const abs = join(WEB_BUNDLE_DIR, rel);
  writeFileSync(abs, body);

  await signInAsTestUser(page);
  await page.goto('/');

  // The watcher indexes the new file → it appears in the server-rendered tree.
  const name = rel.replace(/\.md$/, '');
  const row = page.getByTestId('tree-concept').filter({ hasText: name });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/${name}$`));

  const toggle = page.getByTestId('web-edit-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const editor = page.getByTestId('web-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');

  // Let the island's EventSource finish subscribing before the external change:
  // a broadcast only reaches already-connected subscribers (no DOM signal for
  // "SSE open", hence a short settle — as in web-viewer's live-reload test).
  await page.waitForTimeout(SSE_SETTLE_MS);
  return { editor, toggle, abs };
}

function scratchBody(title: string, body: string): string {
  return `---\ntype: concept\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
}

test('clean buffer: an external change silently reloads + shows the updated notice', async ({
  page,
}) => {
  const rel = 'reload-target.md';
  const { editor, abs } = await openScratchInEdit(
    page,
    rel,
    scratchBody('Reload Target', 'Original clean body.'),
  );
  try {
    // Second writer changes the active file; the buffer is CLEAN → silent reload.
    writeFileSync(abs, scratchBody('Reload Target', 'EXTERNALLY_RELOADED body.'));

    await expect(page.getByTestId('web-updated-notice')).toBeVisible({ timeout: 15_000 });
    // The buffer reloaded from disk to the new content (no conflict modal).
    await expect(editor).toContainText('EXTERNALLY_RELOADED', { timeout: 15_000 });
    await expect(page.getByTestId('web-conflict-modal')).toHaveCount(0);
  } finally {
    rmSync(abs, { force: true });
  }
});

test('dirty buffer: an external change raises the conflict modal; discard reloads clean', async ({
  page,
}) => {
  const rel = 'conflict-target.md';
  const { editor, toggle, abs } = await openScratchInEdit(
    page,
    rel,
    scratchBody('Conflict Target', 'Original body.'),
  );
  try {
    // Make the buffer dirty with local edits.
    const content = editor.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nLOCAL_UNSAVED_EDIT');
    await expect(toggle).toHaveText('Save');

    // Second writer changes the SAME active file → blocking conflict modal.
    writeFileSync(abs, scratchBody('Conflict Target', 'THEIR_NEWER_VERSION body.'));
    const modal = page.getByTestId('web-conflict-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // "Discard my changes & reload" drops local edits + loads their version clean.
    await page.getByTestId('web-conflict-discard').click();
    await expect(modal).toHaveCount(0);
    await expect(editor).toContainText('THEIR_NEWER_VERSION');
    await expect(editor).not.toContainText('LOCAL_UNSAVED_EDIT');
    // Buffer is clean again → the toggle reads "Done", not "Save".
    await expect(toggle).toHaveText('Done');
  } finally {
    rmSync(abs, { force: true });
  }
});

test('dirty buffer: "keep my changes" dismisses the conflict and stays dirty', async ({ page }) => {
  const rel = 'keep-target.md';
  const { editor, toggle, abs } = await openScratchInEdit(
    page,
    rel,
    scratchBody('Keep Target', 'Original body.'),
  );
  try {
    const content = editor.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nKEEP_MY_EDIT');
    await expect(toggle).toHaveText('Save');

    writeFileSync(abs, scratchBody('Keep Target', 'THEIR_VERSION body.'));
    const modal = page.getByTestId('web-conflict-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // "Keep my changes" dismisses the modal; the local buffer stays dirty and
    // still holds the unsaved edit (a later Save would win last-write-wins).
    await page.getByTestId('web-conflict-keep').click();
    await expect(modal).toHaveCount(0);
    await expect(toggle).toHaveText('Save');
    await expect(editor).toContainText('KEEP_MY_EDIT');
  } finally {
    rmSync(abs, { force: true });
  }
});

test('dirty buffer: an external delete of the active Concept shows the deleted state', async ({
  page,
}) => {
  const rel = 'delete-target.md';
  const { editor, toggle, abs } = await openScratchInEdit(
    page,
    rel,
    scratchBody('Delete Target', 'Original body.'),
  );
  try {
    // Dirty the buffer so the delete becomes a recoverable "orphan" (not a
    // silent drop-back to the viewer, which is the clean-buffer behaviour).
    const content = editor.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nUNSAVED_BEFORE_DELETE');
    await expect(toggle).toHaveText('Save');

    // Second writer deletes the active file on disk → deleted-state banner.
    rmSync(abs, { force: true });
    await expect(page.getByTestId('web-deleted-state')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('web-deleted-save')).toBeVisible();
    await expect(page.getByTestId('web-deleted-discard')).toBeVisible();
  } finally {
    rmSync(abs, { force: true });
  }
});
