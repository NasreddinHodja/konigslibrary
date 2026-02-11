<script lang="ts">
  import { manga, getChapterFiles } from '$lib/state.svelte';
  import { intersect } from '$lib/actions/intersect';

  let container: HTMLDivElement;
  let pageRefs: HTMLDivElement[] = $state([]);

  let pageUrls: string[] = $state([]);

  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    let cancelled = false;
    const urls: string[] = [];

    getChapterFiles(chapter).then((blobs) => {
      if (cancelled) return;
      for (const blob of blobs) urls.push(URL.createObjectURL(blob));
      pageUrls = urls;
      manga.shouldScroll = true;
    });

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  // when shouldscroll is set (sidebar page click or progress restore), scroll to that page
  $effect(() => {
    if (!manga.shouldScroll) return;
    manga.shouldScroll = false;
    const idx = manga.currentPage;
    const target = pageRefs[idx];
    if (!target) return;

    // Wait for images up to target to load so their heights are established
    const pending = pageRefs
      .slice(0, idx + 1)
      .map((d) => d?.querySelector('img'))
      .filter((img): img is HTMLImageElement => !!img && !img.complete);

    if (pending.length === 0) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((r) => {
            img.addEventListener('load', () => r(), { once: true });
            img.addEventListener('error', () => r(), { once: true });
          })
      )
    ).then(() => target.scrollIntoView({ block: 'center' }));
  });

  const scrollNext = () => {
    if (manga.currentPage < pageUrls.length - 1) {
      manga.currentPage++;
      pageRefs[manga.currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const scrollPrev = () => {
    if (manga.currentPage > 0) {
      manga.currentPage--;
      pageRefs[manga.currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      scrollNext();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      scrollPrev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (manga.rtl) scrollPrev();
      else scrollNext();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (manga.rtl) scrollNext();
      else scrollPrev();
    }
  };
</script>

<svelte:window onkeydown={handleKey} />

<div
  bind:this={container}
  class="flex h-full flex-1 flex-col gap-2 overflow-y-auto py-4 select-none"
>
  {#each pageUrls as src, i (src)}
    <div
      bind:this={pageRefs[i]}
      class="flex w-full justify-center"
      use:intersect={(visible) => {
        if (visible) manga.currentPage = i;
      }}
    >
      <img
        {src}
        alt="manga page"
        loading="lazy"
        class="mx-auto"
        style="width: {manga.zoom * 100}%"
      />
    </div>
  {/each}
</div>
