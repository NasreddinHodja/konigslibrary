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

<!-- A 1px ink frame; the chapter to resume, 2px more drawn inside it as an
     outline (it takes no room, so the bar stays level with the others') and
     an inverted bar. -->
<button
  class="relative flex aspect-[2/3] cursor-pointer flex-col justify-end overflow-hidden border
    border-ink text-left {highlighted
    ? 'outline-2 -outline-offset-3 outline-ink outline-solid'
    : 'hover:border-hi'}"
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
    class="relative flex items-baseline justify-between gap-1 border-t border-ink px-1 {highlighted
      ? 'bg-ink text-bg'
      : 'bg-bg'}"
  >
    <span class="tabular-nums">{number}</span>
    <span class="tabular-nums {highlighted ? '' : 'text-dim'}">{pageCount}p</span>
  </div>
</button>
