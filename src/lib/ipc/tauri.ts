import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Backend } from './backend';
import type { TreeNode, FileChange, TagCount } from '$lib/types';

/** Tauri event name emitted by the Rust watcher (matches watcher.rs). */
const FILE_CHANGED_EVENT = 'file-changed';

/**
 * Real Backend implementation, talking to Rust over Tauri IPC.
 * Command names match the `#[tauri::command]` functions registered in lib.rs.
 */
export const tauriBackend: Backend = {
  bundleRoot(): Promise<string> {
    return invoke<string>('bundle_root');
  },

  listTree(): Promise<TreeNode> {
    return invoke<TreeNode>('list_tree');
  },

  readConcept(path: string): Promise<string> {
    return invoke<string>('read_concept', { path });
  },

  writeConcept(path: string, content: string): Promise<void> {
    return invoke<void>('write_concept', { path, content });
  },

  onFileChanged(cb: (change: FileChange) => void): () => void {
    // `listen` resolves asynchronously to an unlisten fn; our seam exposes a
    // synchronous unsubscribe. Bridge the two: subscribe eagerly, and have the
    // returned fn detach once (or as soon as) the listener is ready.
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    void listen<FileChange>(FILE_CHANGED_EVENT, (event) => {
      cb(event.payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  },

  listConceptPaths(): Promise<string[]> {
    return invoke<string[]>('list_concept_paths');
  },

  conceptExists(path: string): Promise<boolean> {
    return invoke<boolean>('concept_exists', { path });
  },

  backlinks(path: string): Promise<string[]> {
    return invoke<string[]>('backlinks', { path });
  },

  allTags(): Promise<TagCount[]> {
    return invoke<TagCount[]>('all_tags');
  },

  allTypes(): Promise<string[]> {
    return invoke<string[]>('all_types');
  },
};
