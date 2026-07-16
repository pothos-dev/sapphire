<script lang="ts">
  import App from '$lib/App.svelte';
  import WebViewer from '$lib/web/WebViewer.svelte';
  import type { WebPageData } from '$lib/web/loadConcept';

  // Two shells share the page routes:
  //  - the WEB build (`data.web === true`, from the route `load`) renders the
  //    read-only, SSR'd `WebViewer` over the HTTP backend;
  //  - the DEFAULT desktop/Tauri build renders the full `<App/>` shell.
  // In the web build `$lib/App.svelte` is aliased to an empty stub (see
  // `vite.config.js`), so the heavy editor bundle never enters the SSR web
  // build; in the desktop build `WebViewer` is present but never rendered.
  let { data }: { data: { web: false } | WebPageData } = $props();
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
