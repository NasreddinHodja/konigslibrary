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
    disabled = false,
    objectPosition = 'center',
    onclick,
    overlay,
    placeholder
  }: {
    src: string | null;
    caption: string;
    alt: string;
    active?: boolean;
    loading?: boolean;
    /// Can't be opened: faded, overlay controls still work.
    disabled?: boolean;
    objectPosition?: 'center' | 'top';
    onclick: () => void;
    overlay?: Snippet;
    placeholder?: Snippet;
  } = $props();

  // A broken image falls back like a missing one; a new `src` gets a new try.
  let failed = $derived.by(() => {
    void src;
    return false;
  });
</script>

<div
  class="relative aspect-[2/3] w-full overflow-hidden border-2 transition-colors {active
    ? 'border-fg'
    : disabled
      ? 'border-line'
      : 'border-line hover:border-line-strong'}"
>
  <button
    class="absolute inset-0 h-full w-full cursor-pointer transition-opacity disabled:cursor-default disabled:opacity-40"
    {onclick}
    {disabled}
    aria-label={alt}
    aria-current={active ? 'true' : undefined}
  >
    {#if src && !failed}
      <img
        {src}
        alt=""
        class="absolute inset-0 h-full w-full object-cover {objectPosition === 'top'
          ? 'object-top'
          : ''}"
        loading="lazy"
        onerror={() => (failed = true)}
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
    class="pointer-events-none absolute inset-x-0 bottom-0 bg-bg/75 px-1.5 py-1 backdrop-blur-sm"
  >
    <p class="line-clamp-2 text-xs leading-snug font-medium text-fg">{caption}</p>
  </div>
</div>
