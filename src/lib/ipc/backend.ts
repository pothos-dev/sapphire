import type { TreeNode, FileChange, TagCount } from '$lib/types';

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
   * as detected by the Rust watcher. Emerald's own autosave writes are
   * suppressed and never delivered here. Returns an unsubscribe function.
   */
  onFileChanged(cb: (change: FileChange) => void): () => void;

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

  // slice 14: search(query)
}
