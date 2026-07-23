import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { WEB_BUNDLE_DIR, TEST_AUTH_NAME, TEST_AUTH_EMAIL } from './web-bundle';
import { signInAsTestUser } from './web-auth';

/**
 * Web WRITE happy path over the REAL chain (ticket 09): a test-authed user edits
 * a Concept in the SSR web build and Saves → the SvelteKit hook mints a JWT from
 * the live session → axum verifies it → `sunstone-server` write-then-commits into
 * the served fixture git repo. We assert the rendered content changed AND that a
 * real commit landed authored by the signed-in identity.
 *
 * A dedicated scratch Concept (`edit-target.md`) is written into the SERVED
 * Bundle copy (the temp git repo global-setup built — NOT the in-repo fixture),
 * mirroring `web-viewer.spec.ts`'s live-note pattern, so this spec never mutates
 * the Concepts the read-only `web-viewer` spec asserts on and cleans up after
 * itself.
 */
const TARGET_REL = 'edit-target.md';
const TARGET_ABS = join(WEB_BUNDLE_DIR, TARGET_REL);
const TARGET_BODY = `---
type: concept
title: Edit Target
---

# Edit Target

Original body line.
`;

/** The tip commit's subject + author (name / email), from `git log -1`. */
function headCommit(): { hash: string; subject: string; name: string; email: string } {
  const out = execFileSync(
    'git',
    ['-C', WEB_BUNDLE_DIR, 'log', '-1', '--format=%H%n%s%n%an%n%ae'],
    { encoding: 'utf8' },
  ).split('\n');
  return { hash: out[0], subject: out[1], name: out[2], email: out[3] };
}

test('unauthenticated visit shows no Edit toggle', async ({ page }) => {
  // No session: reach the unauthed branch by simply not signing in (§3).
  await page.context().clearCookies();
  await page.goto('/good');
  await expect(page.getByTestId('rendered').locator('h1')).toContainText('Good Concept');
  // The Edit affordance is shown ONLY to a signed-in user (ticket 06).
  await expect(page.getByTestId('web-edit-toggle')).toHaveCount(0);
});

test('authed Save edits a Concept and lands a real commit as the signed-in user', async ({
  page,
}) => {
  writeFileSync(TARGET_ABS, TARGET_BODY);
  const marker = `WEBWRITE_${Date.now()}`;

  try {
    await signInAsTestUser(page);
    await page.goto(`/${TARGET_REL.replace(/\.md$/, '')}`);
    await expect(page.getByTestId('rendered').locator('h1')).toContainText('Edit Target');

    // Edit toggle is visible for the authed user; entering Edit mounts the island.
    const toggle = page.getByTestId('web-edit-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Edit');
    await toggle.click();

    // The client-only editor island (CodeMirror) mounts in place.
    const editor = page.getByTestId('web-editor');
    await expect(editor).toBeVisible();
    const content = editor.locator('.cm-content');
    await expect(content).toHaveAttribute('contenteditable', 'true');

    // Type at the end of the buffer → the buffer goes dirty → the toggle reads
    // "Save" (web persists only on explicit Save; there is no autosave).
    await content.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n\n${marker}`);
    await expect(toggle).toHaveText('Save');

    // Capture HEAD before Save so we can assert a NEW commit lands.
    const before = headCommit().hash;

    // The Save click flushes the buffer (PUT /api/concept → JWT → axum → commit)
    // then exits back to the rendered view (invalidateAll re-fetches).
    await toggle.click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId('rendered')).toContainText(marker);

    // A real commit landed in the fixture git repo, authored by the test identity.
    await expect
      .poll(() => headCommit().hash, { timeout: 10_000 })
      .not.toBe(before);
    const head = headCommit();
    expect(head.subject).toBe(`edit ${TARGET_REL} via web`);
    expect(head.name).toBe(TEST_AUTH_NAME);
    expect(head.email).toBe(TEST_AUTH_EMAIL);

    // The file content on disk changed to include the typed marker.
    expect(readFileSync(TARGET_ABS, 'utf8')).toContain(marker);
  } finally {
    rmSync(TARGET_ABS, { force: true });
  }
});
