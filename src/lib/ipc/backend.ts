import type { TreeNode, FileChange } from '$lib/types';

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

  // slice 6:  indexQuery(...)
  // slice 14: search(query)
}
