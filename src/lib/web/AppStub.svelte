<!--
  Web-build stub for `$lib/App.svelte`.

  `App.svelte` is the desktop shell (CodeMirror, the full editor, the write
  path). It is browser-only and irrelevant to the read-only web viewer, so in
  the web build `vite.config.js` resolves `$lib/App.svelte` to THIS empty
  component. That keeps the heavy editor bundle (and any import-time
  browser-only code) out of the SSR web build; the web page renders
  `WebViewer` instead (see `src/routes/+page.svelte`).
-->
