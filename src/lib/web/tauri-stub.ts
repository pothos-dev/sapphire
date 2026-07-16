// Web-build stub for `src/lib/ipc/tauri.ts`.
//
// The Tauri backend imports `@tauri-apps/api`, which must NOT be part of the
// web bundle (IPC-seam rule + no native shell on the web). In the web build
// `vite.config.js` resolves `./tauri` to THIS module instead, so the real one
// (and `@tauri-apps/api`) never enter the graph. The web backend selection
// (`__SAPPHIRE_WEB__`) never touches `tauriBackend`, so this proxy is only a
// safety net: any accidental use fails loudly rather than silently.

import type { Backend } from '../ipc/backend';

export const tauriBackend: Backend = new Proxy({} as Backend, {
  get() {
    throw new Error('the Tauri backend is unavailable in the web build');
  },
});
