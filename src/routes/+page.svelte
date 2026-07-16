<script lang="ts">
  import type { PageData } from './$types';
  import App from '$lib/App.svelte';
  import WebViewer from '$lib/web/WebViewer.svelte';

  let { data }: { data: PageData } = $props();

  // Two shells share this entry:
  //  - the WEB build (`data.web === true`, from `+page.ts`) renders the
  //    read-only, SSR'd `WebViewer` over the HTTP backend;
  //  - the DEFAULT desktop/Tauri build renders the full `<App/>` shell.
  // In the web build `$lib/App.svelte` is aliased to an empty stub (see
  // `vite.config.js`), so the heavy editor bundle never enters the SSR web
  // build; in the desktop build `WebViewer` is present but never rendered.
</script>

{#if data.web}
  <WebViewer
    data={{
      bundleRoot: data.bundleRoot,
      tree: data.tree,
      selected: data.selected,
      rendered: data.rendered,
      renderError: data.renderError,
    }}
  />
{:else}
  <App />
{/if}
