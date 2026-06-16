import { backend } from '$lib/ipc';
import type { TreeNode } from '$lib/types';

/**
 * Bundle state: the opened Bundle's absolute root path and its directory tree.
 * Rune-backed (Svelte 5); loaded via the Backend seam.
 */
class BundleStore {
  /** Absolute path of the Bundle root (from the CLI arg / cwd). */
  root = $state<string>('');
  /** Recursive directory tree; null until loaded. */
  tree = $state<TreeNode | null>(null);
  /** True while the initial load is in flight. */
  loading = $state<boolean>(false);
  /** Last load error, if any. */
  error = $state<string | null>(null);

  /** Load the Bundle root and tree from the backend. */
  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [root, tree] = await Promise.all([
        backend.bundleRoot(),
        backend.listTree(),
      ]);
      this.root = root;
      this.tree = tree;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}

export const bundle = new BundleStore();
