<!--
  Web-build stub for `$lib/DesktopShell.svelte`.

  `DesktopShell` is the desktop entry (`PageShell → DesktopShell → App`, a STATIC
  import chain that reaches CodeMirror / the atomic editor). It is desktop-only
  and never rendered on the web (`PageShell` renders `WebViewer` there). In the
  web build `vite.config.js` resolves `$lib/DesktopShell.svelte` to THIS empty
  component on BOTH passes, so the heavy static App/CodeMirror chain stays out of
  the web client's initial chunk. The full `App.svelte` is loaded ONLY via the
  web app-shell island's dynamic `import()` (a lazy chunk) for authed users.
-->
