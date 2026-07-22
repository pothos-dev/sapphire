/**
 * Pure client-side decision logic for the web write concurrency UX (ticket 08).
 *
 * Kept as plain `.ts` (the repo's "pure logic lives in `.ts`" convention) so it
 * is unit-testable under `bun test src/lib`; the editor-island `.svelte` glue
 * stays thin over these helpers. Two concerns live here:
 *   - the per-tab `clientId` echo filter (drop the SSE echo of our own write);
 *   - routing a genuine `FileChange` against the open buffer (added in the
 *     concurrency-UX wiring slice).
 */

import type { FileChange } from '$lib/types';

/**
 * Whether `change` is the echo of THIS tab's own write, i.e. the server stamped
 * it with our `clientId`. Such echoes carry no new information (we already have
 * the content) and must be dropped before any buffer/refresh routing, while
 * every OTHER client treats the same change as genuine (ticket 08 §1).
 */
export function isOwnEcho(change: FileChange, myClientId: string): boolean {
  return change.origin?.clientId === myClientId;
}
