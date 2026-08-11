<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    maxWidth = 'max-w-2xl',
    class: className = '',
    children
  }: {
    maxWidth?: string;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<div class="mx-auto w-full {maxWidth} px-4 md:px-8 {className}">
  {@render children()}
</div>
