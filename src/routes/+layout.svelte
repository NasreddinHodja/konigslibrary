<script lang="ts">
  import './layout.css';
  import favicon from '$lib/assets/favicon.svg';
  import { readerActive } from '$lib/ui/reader-active.svelte';
  import { initTheme } from '$lib/theme';

  let { children } = $props();

  $effect(() => {
    initTheme();
  });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !readerActive.value}
  <div class="fixed top-0 right-0 left-0 z-9998 bg-bg" style="height: var(--safe-top)"></div>
{/if}
{@render children()}
