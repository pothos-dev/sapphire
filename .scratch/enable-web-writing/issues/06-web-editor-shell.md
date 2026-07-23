# 06 — Web editor shell: how editing comes to the web

Type: prototype
Status: resolved (superseded 2026-07-23 — see Update at end)
Blocked by: 03

> **Update 2026-07-23 — decision overridden by user directive.** During build the
> user chose to **replace the static viewer with the full desktop `App.svelte`
> shell for authenticated users** (anonymous still gets the SSR viewer) — i.e. the
> "Full desktop App.svelte" option this ticket originally REJECTED. Rationale: an
> authed user should get real desktop parity (interactive CRUD tree, tile split,
> Region nav), not a viewer with a narrow Edit toggle. The ticket-06 island
> (`WebEditorIsland`) and its narrow Edit-toggle become the anonymous-read path's
> history; the authed path mounts `App.svelte` as a client-only island (SSR-only
> vite stub so the client build gets the real shell). See the new build tickets.

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

## Answer

**Chosen shape: keep `WebViewer`'s SSR read chrome, add a *viewer-default + Edit
toggle*, and mount the existing desktop `Tile.svelte` editor as a client-only
dynamic-`import()` island in the CENTER tile — against the `http` backend.**

The "artifact to react to" was the shell fork made concrete against the real code
(three options × the viewer↔editor relationship); the human picked **Reuse Tile in
the web shell** + **Viewer default + Edit toggle**. Not the full `App.svelte` (drags
the whole editor bundle + workspace-split/region machinery into the web build and
loses the SSR read view) and not a from-scratch web editor (reimplements Tile's
save/anchor logic, drift risk).

**1. Shell & viewer↔editor relationship.**
`WebViewer` stays the SSR-rendered read surface (fast first paint, ticket 03). It
gains an **Edit** affordance, shown only to authenticated users (auth = ticket 04
OAuth session; anonymous never sees it). Clicking Edit swaps the CENTER rendered
article for the editor island in place; **Done/Save returns to the rendered view**
(re-fetch/re-render). One Concept edited at a time — matches "≤1 dirty buffer"
(ticket 05). No multi-tile splitting, no Region-grid nav on the web.

**2. SSR/hydration boundary — the island wraps the *whole* `Tile`, not just `cm.ts`.**
`Tile.svelte` **statically** imports `@codemirror/view`, `@codemirror/commands`, the
`cm.ts` builders and heavy children (`criticMarkupView`, `TileHeader`, `Properties`,
`AnnotationPopup`, …). So `Tile` itself must never be statically imported into the web
SSR graph. Introduce a thin **`WebEditorIsland.svelte`** that WebViewer renders behind
a `{#if browser}` / `onMount` guard and reaches via **dynamic `import()`** — the island
is what pulls in `Tile` (and transitively `cm.ts`). This extends the existing per-
component stub pattern (the `$lib/App.svelte`→`AppStub` vite alias); the CodeMirror /
atomic-editor module-load code stays out of SSR exactly as ticket 03 requires.

**3. Seam reuse is real but *not* free — "unchanged Tile" needs scaffolding.**
`Tile` is coupled to the multi-tile model and 6 stores: it takes a `tile: Tile` prop
from `$lib/state/workspace.svelte` and reads `focus`, `index`, `session`, `suggestions`,
`theme`, `treeActions`. WebViewer today imports only `theme`. So reusing `Tile`
unchanged means `WebEditorIsland` must **construct a single-Tile `workspace` state
object** for the open Concept and provide those stores. `cm.ts` and the editor
internals drive unchanged with only the `http` backend swapped in behind the seam
(the seam already exposes every write method — `http.ts` just rejects them today).

**Build risk carried into implementation (not a further decision):** the store
web-safety of `focus` / `treeActions` / `workspace` / `session` under the web build —
they assume desktop behaviours (Region focus grid, tile splitting, layout persistence).
The island should feed them a minimal/neutral single-Tile state and stub or no-op the
desktop-only affordances rather than port the whole focus/region system. This is
implementation work that folds into the `http.ts` write-impl + editor-island slice
(graduates from ticket 07), not a separate design ticket.

No throwaway running spike was built: the sandbox has no guaranteed browser to observe
one, wayfinder is plan-not-do, and the decision was reachable from the concrete fork +
code inspection above. The store-safety spike, if wanted, belongs in the build slice.
