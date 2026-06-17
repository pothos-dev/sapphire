<script lang="ts">
  // Global styles + self-hosted typeface, loaded once for the whole app.
  // Quicksand is the variable font (300–700) self-hosted via @fontsource — no
  // network fetch, so it works offline in the Tauri shell.
  import '@fontsource-variable/quicksand';
  import '../app.css';

  let { children } = $props();
</script>

{@render children()}
