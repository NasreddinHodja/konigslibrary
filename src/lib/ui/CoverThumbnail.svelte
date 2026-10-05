<script lang="ts">
  import type { Snippet } from 'svelte';
  import Skeleton from './Skeleton.svelte';
  import { authedSrc } from '$lib/api/authed-src.svelte';

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

  const image = authedSrc(() => src);

  // A broken image falls back like a missing one; a new `src` gets a new try.
  let failed = $derived.by(() => {
    void image.current;
    return false;
  });
  // Until the image's bytes arrive, the skeleton shows through it.
  let loaded = $derived.by(() => {
    void image.current;
    return false;
  });
</script>

<!-- A 3px double ink frame; current, a solid one and an inverted caption. -->
<div
  class="relative aspect-[2/3] w-full overflow-hidden border-3 border-ink {active
    ? 'border-solid'
    : disabled
      ? 'border-double'
      : 'border-double hover:border-hi'}"
>
  <button
    class="absolute inset-0 h-full w-full cursor-pointer disabled:cursor-default disabled:opacity-40"
    {onclick}
    {disabled}
    aria-label={alt}
    aria-current={active ? 'true' : undefined}
  >
    {#if image.current && !failed}
      {#if !loaded}
        <Skeleton class="absolute inset-0" />
      {/if}
      <img
        src={image.current}
        alt=""
        class="absolute inset-0 h-full w-full object-cover {objectPosition === 'top'
          ? 'object-top'
          : ''}"
        loading="lazy"
        onload={() => (loaded = true)}
        onerror={() => (failed = true)}
      />
    {:else if loading || image.pending}
      <Skeleton class="absolute inset-0" />
    {:else if placeholder}
      {@render placeholder()}
    {:else}
      <div class="flex h-full w-full items-center justify-center text-dim">no cover</div>
    {/if}
  </button>

  {#if overlay}
    {@render overlay()}
  {/if}

  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 border-t border-ink px-1 {active
      ? 'bg-ink text-bg'
      : 'bg-bg'}"
  >
    <p class="line-clamp-2">{caption}</p>
  </div>
</div>
