<script lang="ts">
  // Client-only island that mounts the FULL desktop `App.svelte` shell on the
  // web for an AUTHENTICATED user (WP0). It mirrors `WebEditorIsland.svelte`'s
  // pattern: `App.svelte` (and, transitively, CodeMirror / the atomic editor) is
  // NEVER statically imported — it is pulled in via a dynamic `import()` behind
  // an `onMount` guard, so it stays out of both the SSR graph and the web
  // client's initial chunk (it lands in a lazy chunk). Until it resolves we show
  // a "Loading workspace…" state.
  //
  // App is mounted cleanly with the SSR-selected Concept as its `initialConcept`
  // (opened into the default tile when the persisted session restores nothing).
  // The concurrency coordinator / beforeunload guard / Save affordance are NOT
  // built here — a later WP owns those; this island only mounts App.
  import { onMount } from 'svelte';
  import type { Component } from 'svelte';

  interface Props {
    /** bundle-relative path of the SSR-selected Concept (forward-slash), or null. */
    selected: string | null;
  }

  let { selected }: Props = $props();

  // The lazily-loaded desktop App shell, resolved in `onMount` (client only) so
  // nothing here is import-time heavy.
  let AppComponent = $state<Component | null>(null);

  onMount(() => {
    let disposed = false;
    void (async () => {
      const mod = await import('$lib/App.svelte');
      if (disposed) return;
      AppComponent = mod.default as unknown as Component;
    })();
    return () => {
      disposed = true;
    };
  });
</script>

{#if AppComponent}
  <div class="web-app-shell" data-testid="web-app-shell">
    <AppComponent initialConcept={selected} />
  </div>
{:else}
  <p class="loading" data-testid="web-app-loading">Loading workspace…</p>
{/if}

<style>
  .web-app-shell {
    height: 100vh;
    min-height: 0;
    min-width: 0;
  }

  .loading {
    padding: 1rem;
    color: var(--text-muted, #777);
  }
</style>
