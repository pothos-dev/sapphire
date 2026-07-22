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
    resolveId(id, importer) {
      if (!isWeb) return null;
      // `src/lib/ipc/index.ts` imports `./tauri` — swap it for the stub so the
      // real Tauri backend (and `@tauri-apps/api`) never enter the graph.
      if (importer && importer.replace(/\\/g, "/").includes("/ipc/index") && /(^|\/)tauri$/.test(id)) {
        return tauriStub;
      }
      // The desktop shell is unused on the web; stub it to an empty component.
      if (id === "$lib/App.svelte") {
        return appStub;
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
