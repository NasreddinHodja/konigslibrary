<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import { nearViewport } from '$lib/ui/near-viewport';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import { chapterThumbnail, knownThumbnail } from './thumbnails';

  let {
    name,
    number,
    title,
    pageCount,
    highlighted,
    onclick
  }: {
    name: string;
    number: string;
    title: string;
    pageCount: number;
    highlighted: boolean;
    onclick: () => void;
  } = $props();

  const reader = getReaderContext();

  let near = $state(false);
  let src: string | null = $state(null);
  let pending = $state(false);

  // The grid keeps tiles mounted well past the screen; the image only comes
  // and goes while the tile is within a screen of the viewport. One already
  // in memory shows at once.
  $effect(() => {
    const provider = reader.provider;
    if (!provider || !near) return;
    const known = knownThumbnail(provider, name);
    src = known;
    if (known) return () => (src = null);
    const controller = new AbortController();
    pending = true;
    chapterThumbnail(provider, name, controller.signal).then((url) => {
      if (controller.signal.aborted) return;
      pending = false;
      if (url) src = url;
    });
    return () => {
      controller.abort();
      pending = false;
      src = null;
    };
  });
</script>

<button
  class="relative flex aspect-[2/3] cursor-pointer flex-col justify-end overflow-hidden border-2 text-left
    {highlighted ? 'border-fg' : 'border-line hover:border-line-strong'}"
  {title}
  aria-label={title}
  {onclick}
  use:nearViewport={(v) => (near = v)}
>
  {#if pending}
    <Skeleton class="absolute inset-0" />
  {:else if src}
    <img {src} alt="" class="absolute inset-0 h-full w-full object-cover object-top" />
  {/if}
  <div
    class="relative flex items-baseline justify-between gap-1 px-1.5 py-1
      {src ? 'bg-bg/85 backdrop-blur-md' : ''}"
  >
    <span class="text-sm font-bold tabular-nums {highlighted ? '' : 'text-soft'}">{number}</span>
    <span class="text-[11px] text-dim tabular-nums">{pageCount}p</span>
  </div>
</button>
