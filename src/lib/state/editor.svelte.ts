import { backend } from '$lib/ipc';

/**
 * Editor state: which Concept is open and its content.
 *
 * Slice 1 is read-only: we load raw markdown and expose it. Dirty/autosave
 * (slice 2) and a real navigation history (slice 5) hang off this store later;
 * the nav history is a minimal stub for now so the shape is established.
 */
class EditorStore {
  /** bundle-relative path of the open Concept, or null if none. */
  path = $state<string | null>(null);
  /** raw markdown of the open Concept. */
  content = $state<string>('');
  /** True while a Concept is loading. */
  loading = $state<boolean>(false);
  /** Last open error, if any. */
  error = $state<string | null>(null);

  /**
   * Navigation history stub. Slice 5 turns this into real back/forward
   * navigation; for now we just record the trail of opened Concepts.
   */
  history = $state<string[]>([]);

  /** Open a Concept by bundle-relative path and load its raw markdown. */
  async open(path: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const content = await backend.readConcept(path);
      this.path = path;
      this.content = content;
      this.history.push(path);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}

export const editor = new EditorStore();
