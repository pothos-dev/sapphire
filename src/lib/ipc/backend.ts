import type {
  TreeNode,
  FileChange,
  TagCount,
  BundleState,
  SearchHit,
  RewriteSummary,
} from '$lib/types';

/**
 * The Backend interface is the ONLY boundary between the frontend and Rust.
 * The frontend never imports `@tauri-apps/api` outside `src/lib/ipc/`.
 *
 * Two implementations satisfy it:
 *  - `tauri.ts`  — real, via `invoke(...)` / `listen(...)`
 *  - `fake.ts`   — in-memory over a seeded fixture Bundle (for Chromium/Playwright)
 *
 * When a slice adds a Rust command, add a method here and implement it in BOTH
 * impls. Paths crossing the seam are always bundle-relative, forward-slash.
 *
 * See ARCHITECTURE.md "The IPC seam".
 */
export interface Backend {
  /** Absolute path of the Bundle root opened via the CLI. */
  bundleRoot(): Promise<string>;

  /** Recursive directory tree of the Bundle (root node has path ''). */
  listTree(): Promise<TreeNode>;

  /** Raw markdown of a single Concept, by bundle-relative path. */
  readConcept(path: string): Promise<string>;

  /**
   * Write a Concept's raw markdown back to disk (autosave), by bundle-relative
   * path. The backend records the write so the filesystem watcher suppresses
   * its own echo (no reload loop / cursor jump).
   */
  writeConcept(path: string, content: string): Promise<void>;

  /**
   * Subscribe to filesystem changes in the Bundle (created/modified/removed),
   * as detected by the Rust watcher. Sapphire's own autosave writes are
   * suppressed and never delivered here. Returns an unsubscribe function.
   */
  onFileChanged(cb: (change: FileChange) => void): () => void;

  // --- Tree CRUD (slice: tree-crud) ---
  // Structural filesystem operations driven from the document tree. All paths
  // are bundle-relative, forward-slash; the backend validates them against the
  // Bundle root and rejects escapes / invalid targets. These are NOT recorded
  // as self-writes: structural changes SHOULD refresh the tree + index via the
  // watcher's `file-changed` event.
  //
  // Rename/move ALSO automatically rewrites links so they stay valid (slice:
  // link-auto-rewrite): inbound links from other Concepts AND the moved
  // Concept's own relative outbound links (folder moves apply this to every
  // contained Concept). They resolve to a `RewriteSummary` so the UI can report
  // how many links/files changed.

  /**
   * Create a new, empty Concept (`.md`) at `path`. The minimal stub is an empty
   * file — the rich frontmatter scaffold is a later slice. Rejects a non-`.md`
   * path, an existing target, or a path whose parent folder is missing.
   */
  createConcept(path: string): Promise<void>;

  /** Create a new folder (and any missing parents) at `path`. */
  createFolder(path: string): Promise<void>;

  /**
   * Rename or move `from` to `to` (both bundle-relative). Works for both
   * Concepts and folders; rejects an existing target or a missing target
   * folder. Links affected by the move are automatically rewritten to stay
   * valid; resolves to a summary of how many links across how many files
   * changed.
   */
  renamePath(from: string, to: string): Promise<RewriteSummary>;

  /**
   * Move `from` into the folder `toDir` (bundle-relative; '' for the Bundle
   * root), keeping the original name. Convenience over `renamePath`; auto
   * rewrites affected links and resolves to the same summary shape.
   */
  movePath(from: string, toDir: string): Promise<RewriteSummary>;

  /**
   * Delete `path` (a Concept or a folder, recursively). The frontend confirms
   * before calling this to avoid accidental data loss.
   */
  deletePath(path: string): Promise<void>;

  // --- Bundle index queries (slice: bundle-index-broken-links) ---
  // The Rust index is built on startup and kept current by the watcher. These
  // are the consumers' read surface over it. Paths are bundle-relative.

  /**
   * Every Concept path in the Bundle index. The broken-link decoration seeds a
   * SYNCHRONOUS existence cache from this (CodeMirror decorations are
   * synchronous, so they cannot await a per-link `conceptExists`). The cache is
   * refreshed on `onFileChanged` and on Concept switch. We expose the full list
   * (over per-path `conceptExists`) precisely because a one-shot snapshot makes
   * the synchronous decoration efficient.
   */
  listConceptPaths(): Promise<string[]>;

  /** Whether a Concept exists at `path` (companion to `listConceptPaths`). */
  conceptExists(path: string): Promise<boolean>;

  /** Sources linking TO `path` (backlinks). Used by the backlinks panel (slice 7). */
  backlinks(path: string): Promise<string[]>;

  /** All tags across the Bundle with per-tag counts. Used by the tags view (slice 8). */
  allTags(): Promise<TagCount[]>;

  /**
   * Concept paths carrying `tag` in their frontmatter `tags`. Used by the tag
   * browser (slice 8) to reveal the Concepts under a selected tag. The query
   * lives in the index (which already holds per-Concept tags) rather than
   * scanning on the frontend.
   */
  conceptsByTag(tag: string): Promise<string[]>;

  /** All distinct frontmatter `type` values. Used by new-concept autocomplete (slice 12). */
  allTypes(): Promise<string[]>;

  /**
   * All distinct top-level frontmatter keys used across the Bundle, sorted.
   * Feeds the Properties panel's key-name autocomplete (key-and-tag
   * autocomplete slice). The OKF recommended keys are merged in client-side, so
   * this is bundle-sourced only (distinct keys from every Concept's frontmatter).
   */
  allKeys(): Promise<string[]>;

  // --- Per-Bundle session state (slice: config-theme-state-store) ---
  // A reusable read/write seam for persisting per-Bundle UI state in the OS
  // config folder, keyed (in the backend) by the Bundle's absolute path. NEVER
  // written into the Bundle (CONTEXT.md). Slices add fields to `BundleState`
  // and round-trip them through this same pair (slice 13: `recentFiles`).

  /**
   * Load this Bundle's persisted session state (last-open Concept, expanded
   * folders, recent files, sidebar flags, window geometry). Robust to a
   * missing/corrupt store: resolves to a fresh-Bundle default (core fields
   * empty — `lastOpenConcept: null`, `expandedFolders: []` — and the optional
   * fields defaulted on read by the session store), never rejects.
   */
  loadBundleState(): Promise<BundleState>;

  /**
   * Persist this Bundle's session state. The frontend calls this (debounced)
   * when the open Concept or expanded folders change. Window geometry is owned
   * by Rust and merged separately, so passing the value loaded earlier carries
   * it through untouched.
   */
  saveBundleState(state: BundleState): Promise<void>;

  // --- Full-text search (slice: full-text-search) ---

  /**
   * Full-text (body content) search across the Bundle, on demand. Scans every
   * `.md` Concept body and returns matches (path + 1-based line + matching line
   * snippet), ordered by path then line. The query is a case-insensitive
   * literal "find text"; an empty/whitespace query yields no matches. The
   * backend caps the result count (a few hundred) so a very common term cannot
   * flood the channel or the UI; the frontend shows the capped list as-is.
   */
  search(query: string): Promise<SearchHit[]>;
}
