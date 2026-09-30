<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import { chapterThumbnail } from './thumbnails';

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

  let src: string | null = $state(null);

  // Tiles only exist while near the viewport (the grid is virtualized), so the
  // thumbnail is requested on mount and cancelled when the tile goes away.
  $effect(() => {
    const provider = reader.provider;
    if (!provider) return;
    const controller = new AbortController();
    let url: string | null = null;
    chapterThumbnail(provider, name, controller.signal).then((blob) => {
      if (controller.signal.aborted || !blob) return;
      url = URL.createObjectURL(blob);
      src = url;
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      src = null;
    };
  });
</script>

<button
  class="relative flex aspect-[2/3] cursor-pointer flex-col justify-end overflow-hidden border-2 text-left
    {highlighted ? 'border-fg' : 'border-border/12 hover:border-border/40'}"
  {title}
  {onclick}
>
  {#if src}
    <img {src} alt="" class="absolute inset-0 h-full w-full object-cover object-top" />
  {/if}
  <div
    class="relative flex items-baseline justify-between gap-1 px-1.5 py-1
      {src ? 'bg-bg/80' : ''}"
  >
    <span class="text-sm font-bold tabular-nums {highlighted ? '' : 'opacity-90'}">{number}</span>
    <span class="text-[0.6rem] tabular-nums opacity-60">{pageCount}p</span>
  </div>
</button>
