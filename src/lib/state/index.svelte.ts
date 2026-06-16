import { backend } from '$lib/ipc';

/**
 * Frontend mirror of the Rust Bundle index's existence set.
 *
 * CodeMirror decorations are SYNCHRONOUS — the broken-link decoration cannot
 * await a per-link `conceptExists` call while building decorations. So we hold a
 * synchronous `Set` of existing Concept paths here, seeded once from
 * `listConceptPaths()` and refreshed whenever the filesystem changes (the
 * watcher's `file-changed` event) so the styling stays fresh as Concepts are
 * created/removed. The decoration checks membership synchronously via `exists`.
 *
 * Rune-backed so consumers (and a CodeMirror refresh trigger) react to changes.
 */
class IndexStore {
  /** Existing Concept paths (bundle-relative). The decoration reads this set. */
  paths = $state<Set<string>>(new Set());
  /**
   * Bumps on every refresh. A monotonically increasing version that the editor
   * layer subscribes to so it can re-run the (otherwise synchronous) broken-link
   * decoration when the index changes, without diffing the set itself.
   */
  version = $state<number>(0);

  /** Synchronous existence check used by the broken-link decoration. */
  exists(path: string): boolean {
    return this.paths.has(path);
  }

  /** (Re)load the existing-path set from the backend index. */
  async refresh(): Promise<void> {
    try {
      const paths = await backend.listConceptPaths();
      this.paths = new Set(paths);
      this.version += 1;
    } catch {
      // Index unavailable: leave the previous set in place. Broken-link styling
      // is best-effort and must never block; a stale set just means a link may
      // briefly look (un)broken until the next refresh.
    }
  }
}

export const indexStore = new IndexStore();
