import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// Build target: `SUNSTONE_TARGET=web` selects the browser/SSR "Sunstone Web"
// build; anything else is the default desktop/Tauri build. Exposed to the app
// as the compile-time constant `__SUNSTONE_WEB__` via `define`, so the IPC seam,
// adapter, and SSR flag can branch on it with the unused branch eliminated.
const isWeb = process.env.SUNSTONE_TARGET === "web";

const tauriStub = fileURLToPath(new URL("./src/lib/web/tauri-stub.ts", import.meta.url));
const appStub = fileURLToPath(new URL("./src/lib/web/AppStub.svelte", import.meta.url));
const desktopShellStub = fileURLToPath(
  new URL("./src/lib/web/DesktopShellStub.svelte", import.meta.url),
);

/**
 * WEB build only: keep `@tauri-apps/api` (and the heavy desktop `App.svelte`)
 * out of the bundle by resolving their imports to inert stubs. This is how the
 * web bundle guarantees the IPC-seam rule (no `@tauri-apps/api` on the web) and
 * avoids SSR-importing browser-only editor code.
 *
 * @returns {import('vite').Plugin}
 */
function sunstoneWebStubs() {
  return {
    name: "sunstone-web-stubs",
    enforce: "pre",
    resolveId(id, importer, options) {
      if (!isWeb) return null;
      // `src/lib/ipc/index.ts` imports `./tauri` — swap it for the stub so the
      // real Tauri backend (and `@tauri-apps/api`) never enter the graph.
      if (importer && importer.replace(/\\/g, "/").includes("/ipc/index") && /(^|\/)tauri$/.test(id)) {
        return tauriStub;
      }
      // `App.svelte` statically imports CodeMirror/atomic-editor (browser-only),
      // so it must never enter the SSR graph — stub it on the SSR pass ONLY. The
      // CLIENT pass resolves the REAL App, which the web app-shell island pulls
      // in via a dynamic `import()` (a lazy chunk), so it stays out of the
      // initial client chunk too.
      if (id === "$lib/App.svelte" && options?.ssr) {
        return appStub;
      }
      // `PageShell → DesktopShell → App` is a STATIC chain and DesktopShell is
      // desktop-only (never rendered on web). Stub it on BOTH web passes so that
      // static chain (and CodeMirror, transitively) is kept out of the web client
      // initial chunk entirely; the real App loads only via the island.
      if (id === "$lib/DesktopShell.svelte") {
        return desktopShellStub;
      }
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sunstoneWebStubs(), sveltekit()],

  define: {
    __SUNSTONE_WEB__: JSON.stringify(isWeb),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
