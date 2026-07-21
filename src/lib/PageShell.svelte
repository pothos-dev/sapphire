<script lang="ts">
  import App from '$lib/App.svelte';
  import WebViewer from '$lib/web/WebViewer.svelte';
  import PrintView from '$lib/print/PrintView.svelte';
  import type { WebPageData } from '$lib/web/loadConcept';

  // Two shells share the page routes:
  //  - the WEB build (`data.web === true`, from the route `load`) renders the
  //    read-only, SSR'd `WebViewer` over the HTTP backend;
  //  - the DEFAULT desktop/Tauri build renders the full `<App/>` shell.
  // A third case cross-cuts both: the print/PDF preview (`?print=<path>`, either
  // build) renders the chrome-free `<PrintView/>` in its own window/tab.
  // In the web build `$lib/App.svelte` is aliased to an empty stub (see
  // `vite.config.js`), so the heavy editor bundle never enters the SSR web
  // build; in the desktop build `WebViewer` is present but never rendered.
  type PrintPageData = { web: false; print: string; toolbar: boolean };
  let { data }: { data: { web: false } | WebPageData | PrintPageData } = $props();
</script>

{#if 'print' in data}
  <PrintView path={data.print} toolbar={data.toolbar} />
{:else if data.web}
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
