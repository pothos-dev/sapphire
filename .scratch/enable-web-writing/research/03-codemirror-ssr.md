# 03 — CodeMirror editor island inside an SSR SvelteKit route

Research for the *Web editor shell* prototype. Sources: SvelteKit docs
(page-options, `$app/environment`), CodeMirror 6 reference, and the Sunstone repo
as it stands (`db31284`). Web access was available; primary-source claims are
linked. Points I could not confirm from docs are labelled **VERIFY**.

## TL;DR recommendation

Keep the web build's **SSR read view** and mount the real editor as a
**client-only island**: an empty container that SSR renders, then `onMount`
(browser-only) does `const { buildEditor } = await import('$lib/editor/cm')` and
calls `buildEditor({ parent: host, … })`. Do **not** drop SSR on the editor
route. The load-bearing detail is that `cm.ts` must be reached by **dynamic
`import()`**, never a static import, so its top-level `@atomic-editor/editor` +
`styles.css` + CodeMirror module-load code never enter the SSR module graph.

## Repo baseline (what already exists)

- `svelte.config.js`: web = `@sveltejs/adapter-node`; desktop = `adapter-static`
  SPA (`fallback: index.html`). Selected by `SUNSTONE_TARGET=web`.
- `src/routes/+layout.ts`: `export const ssr = __SUNSTONE_WEB__` → **web SSR ON**
  at the *layout* level, desktop SSR OFF. `+layout.svelte` has no `onMount`; it
  just loads global CSS and renders children.
- Read path: `+page.ts` / `[...concept]/+page.ts` → `loadConcept()` fetches
  `/api/tree` + `/api/render?path=…` and returns a `RenderPayload` (server HTML).
  `PageShell.svelte` branches on `data.web` and renders `WebViewer.svelte`
  (read-only). First paint is fully server-rendered.
- `src/lib/editor/cm.ts` is the browser-only `EditorView` **builder**. Public
  entry `buildEditor({ parent, doc, frontmatter, path, initialMode, onChange,
  onBlur, brokenLinkContext, wikiLinkContext, … }): EditorView`, which ends in
  `new EditorView({ state, parent })`. Top of the file has **static** side-effect
  imports: `import { … } from '@atomic-editor/editor'`, `import
  '@atomic-editor/editor/code-languages'`, and crucially
  `import '@atomic-editor/editor/styles.css'`. It also touches `window` /
  `navigator` / `document` in several functions (`inheritedTheme`,
  `defaultLinkClick`, clipboard helpers, `selectionForAnnotate`).
- `cm.ts` reaches the backend via `import { backend } from '$lib/ipc'` (e.g.
  `backend.openExternal`). On the web that seam is already the HTTP backend;
  `@tauri-apps/api` is stubbed out.
- Vite already keeps the heavy editor out of the SSR web bundle by **aliasing**
  `$lib/App.svelte` → empty `AppStub.svelte` and `./tauri` → `tauri-stub.ts` in
  the web build (`vite.config.js` `sunstoneWebStubs()` `resolveId`). That is the
  current mechanism preventing browser-only editor code from being SSR-imported.
- The desktop already uses the island shape we want: `App.svelte` renders panes
  with `bind:this` and builds each `EditorView` in `onMount` — it only gets away
  with a *static* `cm` import because that whole route runs under `ssr = false`
  (SPA). On the web we can't rely on that; we must use dynamic import.

## Client-only-component patterns under SSR (primary sources + trade-offs)

`browser` from `$app/environment` is `true` in the browser, `false` during SSR
**and** prerender. `building` is true during build/prerender, `dev` is unreliable
for env detection.
(https://svelte.dev/docs/kit/$app-environment)

| Pattern | What it does | Trade-off for our editor |
|---|---|---|
| `bind:this={host}` + `onMount(() => …)` | Ref is `null` on the server, set after hydration; `onMount` runs **only** in the browser. | **Preferred mount node.** The container is in both server and client markup → **no hydration mismatch**. `onMount` is the natural place to build the view. |
| `onMount` + `await import('…')` (dynamic) | The imported module + its transitive imports/CSS are code-split and **never evaluated on the server**. | **The key tool.** Keeps `cm.ts` (and `@atomic-editor/editor`, its CSS, CodeMirror module-load code) out of the SSR graph. Cost: a small extra chunk fetch after first paint (fine — editor isn't first paint). |
| `{#if browser} … {/if}` | Block renders on client only. | Server renders nothing for that subtree, client renders it → this is itself a **hydration divergence** (Svelte tolerates it but it's the classic "flash"/mismatch source). Fine for *toggling* read-view vs editor **chrome**, but do **not** use it as the editor's mount node — use a stable server-rendered container instead. |
| per-route `export const ssr = false` in `+page.ts` | Disables SSR for that route only. **A child page overrides the parent layout's value** — docs: "Child layouts and pages override values set in parent layouts." So it *does* beat `+layout.ts`'s `ssr = true`. | Turns the editor route into a client-only blank-until-JS page: **loses the SSR'd read payload**, worse first paint / FOUC, no server HTML for crawlers. Keep `csr` at its default `true` (docs: if both `ssr` and `csr` are false, *nothing* renders). |

(https://svelte.dev/docs/kit/page-options)

## Keep SSR + hydrate island vs. drop SSR for the editor route

**Recommendation: keep SSR, mount the editor as an island.**

- *Keep SSR (island):* first paint is the server-rendered rendered-HTML read view
  (already built by `loadConcept` → `RenderPayload`), so the user sees content
  immediately; the editor upgrades in place on mount. Matches the existing web
  architecture and needs no page-option change. Cost: manage the swap so the
  editor doesn't double up with the SSR read DOM (mount into an empty container,
  then toggle read-view↔editor with `{#if}`), and the editor chunk loads slightly
  after paint.
- *Drop SSR per-route (`ssr = false`):* technically works and cleanly overrides
  the layout, but given `+layout.ts` deliberately forces SSR for the web read
  experience, this throws away the server-rendered payload for the editor route:
  blank screen until the JS bundle (CodeMirror + atomic-editor + grammars) loads,
  a real FOUC/first-paint regression, and it fragments the SSR story. Only worth
  it if the editor and read view can't share a route/DOM cleanly — which the
  island pattern avoids.

## CodeMirror-specific SSR pitfalls

1. **`new EditorView(...)` requires a DOM.** The constructor mounts into a
   `parent` element (docs' minimal example uses `parent: document.body`). It
   cannot run during SSR. → build only inside `onMount`/`browser`.
   (https://codemirror.net/docs/ref/)
2. **Module-load browser-global access.** `@codemirror/view` performs
   user-agent/DOM feature detection at import time (its internal `browser`
   object reads `navigator`/`document`). If `cm.ts` is in the SSR module graph,
   evaluating it on the server can throw (`navigator is not defined`). The docs
   don't spell this out — **VERIFY** by attempting a server import — but the safe
   design is to never let it load on the server. Dynamic `import()` inside
   `onMount` guarantees that. `cm.ts` also has top-level browser-touching helpers
   (`inheritedTheme` reads `window.matchMedia`), reinforcing "browser-only
   module."
3. **`@atomic-editor/editor` + `styles.css` import timing.** `cm.ts` statically
   `import '@atomic-editor/editor/styles.css'` and imports the editor package for
   side effects. With a **static** import from an SSR-reachable module, Vite
   hoists that CSS into the route's stylesheet (in `<head>`, no FOUC) **but** also
   pulls the JS into SSR evaluation (pitfall #2). With a **dynamic** import, Vite
   splits the CSS into the editor's async chunk and injects it when the chunk
   loads → the editor's own styles arrive a beat after first mount, a brief
   **editor-only FOUC**. Mitigation if it's visible: keep the SSR read view
   styled by `rendered.css` (already loaded in `+layout.svelte`) until the editor
   chunk + its CSS are ready, then swap; or `<link rel="modulepreload">` the
   editor chunk. Do not statically import the CSS from an SSR path just to avoid
   FOUC — that re-introduces pitfall #2.

## Reaching `cm.ts` from the web shell — the mounting boundary

Concretely, a new web editor island component (sketch, not final):

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorView } from '@codemirror/view'; // type-only: erased, no runtime import
  let host: HTMLElement;              // SSR-rendered empty container (bind:this)
  let view: EditorView | undefined;
  let { doc, frontmatter, path /* … */ } = $props();

  onMount(async () => {
    // Dynamic import → cm.ts + atomic-editor + styles.css stay OUT of the SSR graph.
    const { buildEditor } = await import('$lib/editor/cm');
    view = buildEditor({
      parent: host, doc, frontmatter, path,
      onChange: (content) => { /* route to the HTTP/web write backend */ },
      // brokenLinkContext / wikiLinkContext as the desktop does
    });
    return () => view?.destroy();
  });
</script>

<div bind:this={host}></div>   <!-- stable node in both server & client markup -->
```

Boundary notes:

- `bind:this` + `onMount` (not `{#if browser}`) for the mount node → no hydration
  mismatch; the `<div>` exists identically server- and client-side.
- **Dynamic** `import('$lib/editor/cm')` is mandatory here. A static
  `import … from '$lib/editor/cm'` would make any SSR-reachable ancestor drag the
  editor into the server graph (pitfall #2 / #3). This is the same goal the
  existing `AppStub` alias serves for `App.svelte`, achieved per-component
  instead of by build-wide aliasing.
- `type`-only imports (`import type { EditorView }`) are erased by the compiler,
  so they don't count as runtime imports and are SSR-safe.
- `cm.ts` already funnels backend access through `$lib/ipc` `backend`, which is
  the HTTP backend on the web. The **write** methods `onChange` needs must exist
  on the web backend — out of scope for this mounting question but the immediate
  follow-on for the prototype ticket.
- To avoid the SSR read view and the editor both occupying the DOM, render the
  SSR'd `WebViewer`/rendered HTML for first paint and swap to the editor island
  once mounted (e.g. an `{#if editorReady}` toggle set at the end of `onMount`),
  or mount the editor into a separate container and hide the read view.

## Open items to verify in the prototype

- **VERIFY** that importing `cm.ts` server-side actually throws (confirms pitfall
  #2 severity) — quick check: `SUNSTONE_TARGET=web` build + a deliberate static
  import, or a node `import()` of `@codemirror/view`.
- **VERIFY** the editor-CSS FOUC is perceptible with the dynamic-import chunk; if
  so pick a mitigation (modulepreload vs. keep read view until ready).
- Web backend **write** surface for `onChange`/autosave (separate ticket).
