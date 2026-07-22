# 03 — Research: CodeMirror editor under SvelteKit SSR

Type: research
Status: claimed
Blocked by: None

## Question

The desktop app runs the CodeMirror + atomic-editor editor in an **adapter-static SPA
(`ssr = false`)**. The web build is **adapter-node with SSR on** (`+layout.ts`), and
its current UI is a server-rendered HTML *viewer*. To bring the real editor to the
web, how do we host a **client-only CodeMirror island inside an SSR SvelteKit route**?

Investigate (primary sources: SvelteKit + CodeMirror 6 docs):

- Patterns for a **client-only component under SSR**: `browser` guard, `onMount`
  dynamic `import()`, `{#if browser}`, per-route `ssr = false`, and their trade-offs
  (hydration mismatch, flash, first paint).
- Whether the web should keep SSR for the read view and hydrate the editor as an
  island, or drop SSR for the editor route entirely — and what that costs given
  `+layout.ts` currently forces SSR.
- Any CodeMirror-specific SSR pitfalls (accessing `document`/`window` at module load,
  `@atomic-editor/editor` and `styles.css` import timing).
- How the existing `src/lib/editor/cm.ts` builder would be reached from the web shell
  (it's already browser-only logic; the question is the mounting boundary, not the
  editor internals).

Write findings to `.scratch/enable-web-writing/research/03-codemirror-ssr.md` and link
them here. Feeds the *Web editor shell* prototype ticket.
