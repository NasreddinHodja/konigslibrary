<script lang="ts">
  import type { Snippet } from 'svelte';

  // A phone-sized screen over the texture. Its content scrolls inside;
  // anything pinned to the screen is `absolute`, against this frame.
  let {
    title,
    texture = undefined,
    children
  }: { title: string; texture?: string; children: Snippet } = $props();
</script>

<figure class="flex shrink-0 flex-col gap-2">
  <figcaption class="text-(--dim)">{title}</figcaption>
  <div class="relative h-[844px] w-[390px] overflow-hidden border border-(--ink) bg-(--bg)">
    {#if texture}
      <!-- Pixelated on its own layer, so covers inside still scale smoothly. -->
      <div
        class="absolute inset-0"
        style:background-image="url({texture})"
        style:image-rendering="pixelated"
      ></div>
    {/if}
    {@render children()}
  </div>
</figure>
