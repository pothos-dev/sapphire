<script lang="ts">
  // Global styles + self-hosted typeface, loaded once for the whole app.
  // Jost is the variable font self-hosted via @fontsource — no network fetch,
  // so it works offline in the Tauri shell.
  import '@fontsource-variable/jost';
  import '../app.css';
  // Rendered-body content styles, shared by the web viewer's `.rendered` article
  // and the desktop Export-as-PDF `.print-root` (so both surfaces style the same
  // server-rendered HTML identically). See `src/lib/rendered.css`.
  import '$lib/rendered.css';

  let { children } = $props();
</script>

{@render children()}
