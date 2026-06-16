import type { Backend } from './backend';
import { tauriBackend } from './tauri';
import { fakeBackend } from './fake';

export type { Backend } from './backend';

/**
 * Runtime selection of the Backend implementation.
 *
 * Inside the Tauri webview, `__TAURI_INTERNALS__` is present on `window`, so we
 * use the real IPC-backed impl. In plain Chromium (vite dev / Playwright) it is
 * absent, so we fall back to the in-memory fake fixture Bundle.
 *
 * See ARCHITECTURE.md "The IPC seam".
 */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const backend: Backend = isTauri ? tauriBackend : fakeBackend;

// Expose the selected backend on `window` as a stable test hook (mirrors
// `window.__emeraldFake` in fake.ts). Playwright reads this instead of
// dynamically importing the source module, so the query specs work against both
// the dev server and a precompiled production build (where `/src/...` paths do
// not exist).
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__emeraldBackend = backend;
}
