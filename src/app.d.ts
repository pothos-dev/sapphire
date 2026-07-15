// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /**
   * Build-time target flag, replaced by Vite's `define` (see `vite.config.js`).
   * `true` for the "Sapphire Web" build (`SAPPHIRE_TARGET=web`), `false` for the
   * default desktop/Tauri build. The IPC seam and adapter selection branch on it;
   * because it is a compile-time constant, the unused branch is eliminated.
   */
  const __SAPPHIRE_WEB__: boolean;
}

export {};
