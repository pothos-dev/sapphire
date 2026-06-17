import { backend } from '$lib/ipc';
import type { TreeNode } from '$lib/types';

/**
 * Bundle state: the opened Bundle's directory tree.
 * Rune-backed (Svelte 5); loaded via the Backend seam.
 */
class BundleStore {
  /** Recursive directory tree; null until loaded. */
  tree = $state<TreeNode | null>(null);
  /** True while the initial load is in flight. */
  loading = $state<boolean>(false);
  /** Last load error, if any. */
  error = $state<string | null>(null);

  /** Load the Bundle tree from the backend. */
  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.tree = await backend.listTree();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}

export const bundle = new BundleStore();
