<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="mx-auto w-full max-w-4xl px-4 md:px-8">
  {@render children()}
</div>
