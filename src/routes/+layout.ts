// SSR is target-dependent (build-time `__SAPPHIRE_WEB__`, replaced by Vite):
//
//  - WEB build (`SAPPHIRE_TARGET=web`): SSR ON. The read-only shell (Explorer
//    tree + Concept reader) is server-rendered by adapter-node, then hydrates.
//  - DEFAULT (desktop/Tauri): SSR OFF. Tauri has no Node server, so we ship a
//    static SPA (adapter-static, fallback index.html) exactly as before.
//
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/
export const ssr = __SAPPHIRE_WEB__;
