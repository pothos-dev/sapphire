import type { Backend } from './backend';
import type {
  TreeNode,
  FileChange,
  TagCount,
  BundleState,
  SearchHit,
  RewriteSummary,
} from '$lib/types';

/**
 * Read-only HTTP Backend implementation for the "Sapphire Web" build target,
 * talking to the `sapphire-server` axum binary over `fetch`.
 *
 * It implements ONLY the read methods needed by the walking skeleton
 * (`bundleRoot`, `listTree`, `readConcept`). Everything else is deliberately
 * inert:
 *   - WRITE methods reject with a clear "read-only web build" error — the web
 *     surface has no write path (by design, this slice and beyond).
 *   - The remaining READ methods (index queries, tags, search, session state)
 *     land in later slices; they reject with a "not implemented in slice 2"
 *     marker so a premature call fails loudly rather than silently.
 *   - `onFileChanged` is a no-op returning an unsubscribe (SSE arrives in a
 *     later slice).
 *
 * Requests target relative `/api/...` (same origin). In the browser those hit
 * the SvelteKit origin and are proxied to the Rust server (see the `/api`
 * proxy in `src/hooks.server.ts`), avoiding CORS and keeping one public origin.
 * SSR reads its data directly in `+page.ts`'s `load`, so this seam is primarily
 * the hydrated-island path.
 *
 * See ARCHITECTURE.md "The IPC seam" and the web-readonly-api ticket.
 */

/** Error thrown by every write method — the web build has no write path. */
const READ_ONLY = 'read-only web build: writes are not available on the web';
/** Marker for read methods that later slices will implement. */
const NOT_YET = 'not implemented in slice 2 (web read-only skeleton)';

/** GET `url` and parse the JSON body, mapping a non-2xx to a thrown Error. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    // The server sends a plain-text message body for 4xx (e.g. path escapes).
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${detail || url}`);
  }
  return (await res.json()) as T;
}

export const httpBackend: Backend = {
  bundleRoot(): Promise<string> {
    return getJson<string>('/api/bundle-root');
  },

  listTree(): Promise<TreeNode> {
    return getJson<TreeNode>('/api/tree');
  },

  readConcept(path: string): Promise<string> {
    return getJson<string>(`/api/concept?path=${encodeURIComponent(path)}`);
  },

  // --- Write path: never available on the web (read-only build). ------------
  writeConcept(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  },
  createConcept(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  },
  createFolder(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  },
  renamePath(): Promise<RewriteSummary> {
    return Promise.reject(new Error(READ_ONLY));
  },
  movePath(): Promise<RewriteSummary> {
    return Promise.reject(new Error(READ_ONLY));
  },
  deletePath(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  },
  rewriteAnchors(): Promise<RewriteSummary> {
    return Promise.reject(new Error(READ_ONLY));
  },
  saveBundleState(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  },

  // --- Filesystem change events: no-op until SSE (later slice). -------------
  onFileChanged(_cb: (change: FileChange) => void): () => void {
    return () => {};
  },

  // --- Read methods that later slices implement over HTTP. ------------------
  listConceptPaths(): Promise<string[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  conceptExists(): Promise<boolean> {
    return Promise.reject(new Error(NOT_YET));
  },
  backlinks(): Promise<string[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  allTags(): Promise<TagCount[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  conceptsByTag(): Promise<string[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  allTypes(): Promise<string[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  allKeys(): Promise<string[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  loadBundleState(): Promise<BundleState> {
    return Promise.reject(new Error(NOT_YET));
  },
  search(): Promise<SearchHit[]> {
    return Promise.reject(new Error(NOT_YET));
  },
};
