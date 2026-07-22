import type { Backend } from './backend';
import type {
  TreeNode,
  FileChange,
  TagCount,
  BundleState,
  SearchHit,
  RewriteSummary,
  FileHistory,
  FileAtRev,
  RenderPayload,
  KnownBundle,
} from '$lib/types';

/**
 * Read-only HTTP Backend implementation for the "Sunstone Web" build target,
 * talking to the `sunstone-server` axum binary over `fetch`.
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

/**
 * Parse one SSE `data:` payload into a `FileChange`, or `null` if it is not a
 * well-formed change (malformed JSON, or missing/typed-wrong fields). Pure so
 * it can be unit-tested; the `EventSource` handler in `onFileChanged` only
 * invokes the callback for a non-null result.
 */
export function parseFileChange(data: string): FileChange | null {
  try {
    const raw = JSON.parse(data) as Partial<FileChange>;
    if (
      (raw.kind === 'created' || raw.kind === 'modified' || raw.kind === 'removed') &&
      Array.isArray(raw.paths) &&
      raw.paths.every((p) => typeof p === 'string')
    ) {
      return { kind: raw.kind, paths: raw.paths };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const httpBackend: Backend = {
  bundleRoot(): Promise<string> {
    return getJson<string>('/api/bundle-root');
  },

  // Launcher seam: the web build always serves a single, fixed Bundle and has no
  // launcher UI, so `currentBundle` reports that Bundle as open and the rest are
  // inert (never reached by the web viewer).
  currentBundle(): Promise<string | null> {
    return getJson<string>('/api/bundle-root');
  },
  listKnownBundles(): Promise<KnownBundle[]> {
    return Promise.resolve([]);
  },
  forgetBundle(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  },
  openBundle(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  },
  pickFolder(): Promise<string | null> {
    return Promise.resolve(null);
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

  // --- Filesystem change events over SSE (`/api/events`). -------------------
  // Every connected browser live-updates when Concepts change on disk (edited
  // by any external tool — the web app never writes). `EventSource` targets the
  // relative `/api/events` (proxied to the Rust server, streamed un-buffered);
  // it auto-reconnects on a dropped connection. The returned unsubscribe is
  // synchronous (matching the seam contract): it closes the stream at once.
  onFileChanged(cb: (change: FileChange) => void): () => void {
    // No EventSource under SSR / non-browser — nothing to subscribe to.
    if (typeof EventSource === 'undefined') return () => {};
    const source = new EventSource('/api/events');
    source.onmessage = (e: MessageEvent) => {
      const change = parseFileChange(typeof e.data === 'string' ? e.data : '');
      if (change) cb(change);
    };
    return () => source.close();
  },

  // --- Index-backed read queries over the proxied `/api/...` routes. --------
  // Back the read-only sidebar Sections (Backlinks, Tags) served by the core
  // in-memory index. Paths crossing the seam are bundle-relative, forward-slash.
  listConceptPaths(): Promise<string[]> {
    return getJson<string[]>('/api/concept-paths');
  },
  conceptExists(path: string): Promise<boolean> {
    return getJson<boolean>(`/api/concept-exists?path=${encodeURIComponent(path)}`);
  },
  backlinks(path: string): Promise<string[]> {
    return getJson<string[]>(`/api/backlinks?path=${encodeURIComponent(path)}`);
  },
  allTags(): Promise<TagCount[]> {
    return getJson<TagCount[]>('/api/tags');
  },
  conceptsByTag(tag: string): Promise<string[]> {
    return getJson<string[]>(`/api/concepts-by-tag?tag=${encodeURIComponent(tag)}`);
  },

  // Not needed by the read-only web sidebars (new-concept autocomplete /
  // Properties key autocomplete are editor-only) — land in a later slice.
  allTypes(): Promise<string[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  allKeys(): Promise<string[]> {
    return Promise.reject(new Error(NOT_YET));
  },
  loadBundleState(): Promise<BundleState> {
    return Promise.reject(new Error(NOT_YET));
  },

  // Bundle-wide full-text search over the proxied `/api/search` (backed by the
  // core ripgrep search: case-insensitive literal, ordered by path then line,
  // capped server-side). An empty/whitespace query yields `[]` (no scan).
  search(query: string): Promise<SearchHit[]> {
    return getJson<SearchHit[]>(`/api/search?q=${encodeURIComponent(query)}`);
  },

  // Git seam: the read-only web build exposes no git route, so history is
  // simply unavailable. Report it gracefully (`gitMissing`) rather than
  // rejecting, so the shared review-diff UI just disables its toggle.
  fileHistory(): Promise<FileHistory> {
    return Promise.resolve({ status: 'gitMissing' });
  },
  fileAtRev(): Promise<FileAtRev> {
    return Promise.resolve({ status: 'gitMissing' });
  },

  // Server-quality render over the proxied `/api/render` — the same route the
  // web viewer's `loadConcept` uses (body HTML + frontmatter + outline). Paths
  // are bundle-relative, forward-slash.
  renderConcept(path: string): Promise<RenderPayload> {
    return getJson<RenderPayload>(`/api/render?path=${encodeURIComponent(path)}`);
  },

  // The web viewer opens its own chrome-free print tab directly (no toolbar,
  // relying on the browser's native print → Save-as-PDF UI), so this seam is
  // unused on web; implemented for interface parity as a new tab WITH toolbar.
  async openPrintWindow(path: string): Promise<void> {
    window.open(`/?print=${encodeURIComponent(path)}&toolbar=1`, '_blank');
  },

  // The web viewer relies on the browser's native print → Save-as-PDF, so direct
  // export has no server-side counterpart; resolve to `null` (no file written).
  async savePdf(_defaultName: string): Promise<string | null> {
    return null;
  },

  // On the web the app already runs in the browser, so a new tab IS the default
  // application; open it directly.
  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
};
