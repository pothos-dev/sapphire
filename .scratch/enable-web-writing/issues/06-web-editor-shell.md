# 06 — Web editor shell: how editing comes to the web

Type: prototype
Status: open
Blocked by: 03

## Question

Today the web serves `src/lib/web/*` — a server-rendered HTML *viewer* (`WebViewer`,
`WebTree`, `WebOutline`, …), NOT the desktop `App.svelte` + CodeMirror editor. How
should the editable web surface be structured?

Decide (make a cheap prototype to react to — see `/prototype`):

- **Reuse vs web-tailored shell.** Does the web load the full desktop `App.svelte`
  editor shell (tree pane | editor pane | sidebars) against the `http` backend, or a
  web-tailored shell that hosts just the CodeMirror editor island beside the existing
  web viewer chrome?
- **Viewer ↔ editor relationship.** Is the rendered-HTML viewer kept as the read mode
  with an "Edit" affordance that swaps in the editor, or does the editor become the
  default surface for authenticated users?
- **The SSR/hydration boundary** (grounded by ticket 03's findings) — where the
  client-only editor island mounts within the SSR web build.
- **Seam reuse** — confirm `src/lib/editor/cm.ts` and the state stores drive the web
  editor unchanged, with only the `http` backend swapped in behind the seam.

Link the prototype as an asset and record the chosen shape under `## Answer`.
