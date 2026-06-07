<script lang="ts">
  import './layout.css';
  import favicon from '$lib/assets/favicon.svg';
  import { readerActive } from '$lib/ui/reader-active.svelte';

  let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !readerActive.value}
  <div class="fixed top-0 right-0 left-0 z-[9999] bg-bg" style="height: var(--safe-top)"></div>
{/if}
{@render children()}
