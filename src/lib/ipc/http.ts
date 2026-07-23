import type { Backend } from './backend';
import { isOwnEcho } from '$lib/web/concurrency';
import type {
  TreeNode,
  FileChange,
  TagCount,
  BundleState,
  SearchHit,
  RewriteSummary,
  AnchorRename,
  FileHistory,
  FileAtRev,
  RenderPayload,
  KnownBundle,
} from '$lib/types';

/**
 * HTTP Backend implementation for the "Sunstone Web" build target, talking to
 * the `sunstone-server` axum binary over `fetch`.
 *
 * Reads (`bundleRoot`, `listTree`, `readConcept`, the index queries, search,
 * render) are open. WRITES (`writeConcept`, Tree CRUD, `rewriteAnchors`) are the
 * authenticated, git-backed write path (ticket 07): each maps 1:1 to a server
 * write route; the `/api` hook attaches the auth JWT on writes only. A few
 * launcher/session methods are inapplicable on the web (single fixed Bundle,
 * View state client-side) and stay inert.
 *
 * Requests target relative `/api/...` (same origin). In the browser those hit
 * the SvelteKit origin and are proxied to the Rust server (see the `/api`
 * proxy in `src/hooks.server.ts`), avoiding CORS and keeping one public origin.
 * SSR reads its data directly in `+page.ts`'s `load`, so this seam is primarily
 * the hydrated-island path.
 *
 * See ARCHITECTURE.md "The IPC seam" and the enable-web-writing effort.
 */

/** The web serves ONE fixed Bundle and has no launcher, so folder switching is
 * inapplicable (writing Concepts, by contrast, is now supported — see below). */
const NO_LAUNCHER = 'the web serves a single fixed Bundle: no folder switching';

/**
 * `localStorage` key for the web build's per-Bundle View state. The web serves
 * a single fixed Bundle, so one key suffices (mirrors `web/uiState.ts`'s
 * `sunstone:webUI` naming convention). NEVER committed into the Bundle — this
 * is per-user View state (docs/GLOSSARY.md).
 */
const BUNDLE_STATE_KEY = 'sunstone:bundleState';

/** Fresh-Bundle default (mirrors the Rust `BundleState::default`). */
function defaultBundleState(): BundleState {
  return { lastOpenConcept: null, expandedFolders: [], recentFiles: [] };
}

/**
 * Load the web Bundle's View state from `localStorage`. Returns the fresh
 * default on the server (SSR: no `localStorage`), a missing key, or corrupt
 * JSON — never rejects. Optional fields pass through untouched (the session
 * store defaults each on read).
 */
function loadWebBundleState(): BundleState {
  if (typeof localStorage === 'undefined') return defaultBundleState();
  const raw = localStorage.getItem(BUNDLE_STATE_KEY);
  if (raw === null) return defaultBundleState();
  try {
    const parsed = JSON.parse(raw) as Partial<BundleState>;
    return {
      ...parsed,
      lastOpenConcept: parsed.lastOpenConcept ?? null,
      expandedFolders: Array.isArray(parsed.expandedFolders) ? parsed.expandedFolders : [],
      recentFiles: Array.isArray(parsed.recentFiles) ? parsed.recentFiles : [],
    };
  } catch {
    return defaultBundleState();
  }
}

/** Persist the web Bundle's View state to `localStorage`. A no-op on the server
 * or if storage is full/disabled (best-effort — never throws into the UI). */
function saveWebBundleState(state: BundleState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BUNDLE_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled — best-effort, never throw */
  }
}

/**
 * This tab's write client id (ticket 08): minted once per tab, in-memory, and
 * forwarded on every web write as `x-sunstone-client`. The server stamps the
 * SSE broadcast with it so this tab drops its own echo while every other tab
 * treats the change as genuine. NOT persisted — two tabs are independent
 * writers, so each reloads on the other's write (correct last-write-wins).
 */
export const CLIENT_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

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
 * Map a write route's HTTP status + server detail to a user-facing message
 * (ticket 07 §8 taxonomy: 400 invalid path / 409 conflict / 404 missing / 401
 * unauthenticated / 500 server). Pure so it is unit-testable; `sendJson` throws
 * an `Error` carrying this message on any non-2xx write response.
 */
export function httpWriteError(status: number, detail: string): string {
  const extra = detail.trim() ? `: ${detail.trim()}` : '';
  switch (status) {
    case 400:
      return `Invalid path${extra}`;
    case 401:
      return 'You are not signed in, or your session expired — sign in to edit.';
    case 404:
      return `Not found${extra}`;
    case 409:
      return `Conflict${extra}`;
    default:
      return `Save failed (${status})${extra}`;
  }
}

/**
 * Send a JSON write to `url` with `method`, forwarding the per-tab `clientId`.
 * A `204 No Content` resolves to `undefined`; a `200` parses its JSON body
 * (a `RewriteSummary`). A non-2xx throws with a `httpWriteError` message.
 */
async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-sunstone-client': CLIENT_ID,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(httpWriteError(res.status, detail));
  }
  // 204 (writeConcept/create/delete) has no body; 200 carries a RewriteSummary.
  if (res.status === 204) return undefined as T;
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
      const change: FileChange = { kind: raw.kind, paths: raw.paths };
      // A web write carries an `origin` stamp (clientId + author); external /
      // desktop edits omit it. Carry it through only when well-formed.
      const origin = raw.origin;
      if (
        origin &&
        typeof origin.clientId === 'string' &&
        origin.author &&
        typeof origin.author.name === 'string'
      ) {
        change.origin = { clientId: origin.clientId, author: { name: origin.author.name } };
      }
      return change;
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
    return Promise.reject(new Error(NO_LAUNCHER));
  },
  openBundle(): Promise<void> {
    return Promise.reject(new Error(NO_LAUNCHER));
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

  // --- Write path (ticket 07): authenticated, git-backed, commit-per-op. -----
  // Each maps 1:1 to a `sunstone-server` write route; the `/api` hook attaches
  // the auth JWT (writes only). `x-sunstone-client` carries this tab's clientId
  // so the SSE echo of our own write is dropped (see `onFileChanged`). Errors
  // surface via `httpWriteError` (401/400/404/409/500).
  writeConcept(path: string, content: string): Promise<void> {
    return sendJson<void>('PUT', '/api/concept', { path, content });
  },
  createConcept(path: string): Promise<void> {
    return sendJson<void>('POST', '/api/concept', { path });
  },
  createFolder(path: string): Promise<void> {
    return sendJson<void>('POST', '/api/folder', { path });
  },
  renamePath(from: string, to: string): Promise<RewriteSummary> {
    return sendJson<RewriteSummary>('POST', '/api/rename', { from, to });
  },
  movePath(from: string, toDir: string): Promise<RewriteSummary> {
    return sendJson<RewriteSummary>('POST', '/api/move', { from, toDir });
  },
  deletePath(path: string): Promise<void> {
    return sendJson<void>('DELETE', `/api/concept?path=${encodeURIComponent(path)}`);
  },
  rewriteAnchors(target: string, renames: AnchorRename[]): Promise<RewriteSummary> {
    return sendJson<RewriteSummary>('POST', '/api/rewrite-anchors', { target, renames });
  },

  // `saveBundleState` is off the server write surface (ticket 07 §6): it is
  // per-user *View state*, never committed into the shared Bundle. On the web it
  // is a purely client-side concern, so we round-trip it through `localStorage`
  // (see `loadBundleState` / `saveWebBundleState`), SSR-safe.
  saveBundleState(state: BundleState): Promise<void> {
    saveWebBundleState(state);
    return Promise.resolve();
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
      // Drop the echo of THIS tab's own write (ticket 08 §1): we already have
      // that content. Every other client sees it as a genuine change.
      if (change && !isOwnEcho(change, CLIENT_ID)) cb(change);
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

  // New-concept `type` autocomplete + Properties key autocomplete, served by
  // the core in-memory index over the read-only `/api/types` + `/api/keys`
  // routes (the OKF recommended keys are merged in client-side).
  allTypes(): Promise<string[]> {
    return getJson<string[]>('/api/types');
  },
  allKeys(): Promise<string[]> {
    return getJson<string[]>('/api/keys');
  },
  loadBundleState(): Promise<BundleState> {
    return Promise.resolve(loadWebBundleState());
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
