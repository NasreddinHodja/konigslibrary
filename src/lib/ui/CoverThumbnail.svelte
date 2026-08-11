<script lang="ts">
  import type { Snippet } from 'svelte';
  import { BookOpen } from 'lucide-svelte';
  import Skeleton from './Skeleton.svelte';

  let {
    src,
    caption,
    alt,
    active = false,
    loading = false,
    objectPosition = 'center',
    onclick,
    onImgError,
    overlay,
    placeholder
  }: {
    src: string | null;
    caption: string;
    alt: string;
    active?: boolean;
    loading?: boolean;
    objectPosition?: 'center' | 'top';
    onclick: () => void;
    onImgError?: () => void;
    overlay?: Snippet;
    placeholder?: Snippet;
  } = $props();
</script>

<div
  class="relative aspect-[2/3] w-full overflow-hidden border-2 transition-colors {active
    ? 'border-fg'
    : 'border-border/10 hover:border-border/40'}"
>
  <button
    class="absolute inset-0 h-full w-full cursor-pointer"
    {onclick}
    aria-label={alt}
    aria-current={active ? 'true' : undefined}
  >
    {#if src}
      <img
        {src}
        alt=""
        class="absolute inset-0 h-full w-full object-cover {objectPosition === 'top'
          ? 'object-top'
          : ''}"
        loading="lazy"
        onerror={onImgError}
      />
    {:else if loading}
      <Skeleton class="absolute inset-0" />
    {:else if placeholder}
      {@render placeholder()}
    {:else}
      <div class="flex h-full w-full items-center justify-center bg-fg/[0.03]">
        <BookOpen size={22} class="opacity-20" />
      </div>
    {/if}
  </button>

  {#if overlay}
    {@render overlay()}
  {/if}

  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg/95 via-bg/70 to-transparent px-1.5 pt-5 pb-1.5"
  >
    <p class="line-clamp-2 text-xs leading-snug font-medium text-fg">{caption}</p>
  </div>
</div>
