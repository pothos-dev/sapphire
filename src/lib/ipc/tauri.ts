import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Backend } from './backend';
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
} from '$lib/types';

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

  createConcept(path: string): Promise<void> {
    return invoke<void>('create_concept', { path });
  },

  createFolder(path: string): Promise<void> {
    return invoke<void>('create_folder', { path });
  },

  renamePath(from: string, to: string): Promise<RewriteSummary> {
    return invoke<RewriteSummary>('rename_path', { from, to });
  },

  movePath(from: string, toDir: string): Promise<RewriteSummary> {
    // Tauri command arg names are snake_case; `to_dir` matches lib.rs.
    return invoke<RewriteSummary>('move_path', { from, toDir });
  },

  deletePath(path: string): Promise<void> {
    return invoke<void>('delete_path', { path });
  },

  rewriteAnchors(target: string, renames: AnchorRename[]): Promise<RewriteSummary> {
    return invoke<RewriteSummary>('rewrite_anchors', { target, renames });
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

  conceptsByTag(tag: string): Promise<string[]> {
    return invoke<string[]>('concepts_by_tag', { tag });
  },

  allTypes(): Promise<string[]> {
    return invoke<string[]>('all_types');
  },

  allKeys(): Promise<string[]> {
    return invoke<string[]>('all_keys');
  },

  loadBundleState(): Promise<BundleState> {
    return invoke<BundleState>('load_bundle_state');
  },

  saveBundleState(state: BundleState): Promise<void> {
    // Tauri command arg names are snake_case; `bundle_state` matches lib.rs.
    return invoke<void>('save_bundle_state', { bundleState: state });
  },

  search(query: string): Promise<SearchHit[]> {
    return invoke<SearchHit[]>('search', { query });
  },

  fileHistory(path: string): Promise<FileHistory> {
    return invoke<FileHistory>('file_history', { path });
  },

  fileAtRev(path: string, rev: string): Promise<FileAtRev> {
    return invoke<FileAtRev>('file_at_rev', { path, rev });
  },
};
