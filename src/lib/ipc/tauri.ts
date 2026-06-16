import { invoke } from '@tauri-apps/api/core';
import type { Backend } from './backend';
import type { TreeNode } from '$lib/types';

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
};
