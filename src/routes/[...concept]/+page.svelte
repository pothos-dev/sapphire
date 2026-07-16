<script lang="ts">
  import type { PageData } from './$types';
  import PageShell from '$lib/PageShell.svelte';

  let { data }: { data: PageData } = $props();
</script>

<PageShell {data} />
