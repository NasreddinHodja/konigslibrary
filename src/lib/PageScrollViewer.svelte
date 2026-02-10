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
      manga.currentPage = 0;
      if (container) container.scrollTo({ top: 0 });
    });

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  // When shouldScroll is set (sidebar page click), scroll to that page
  $effect(() => {
    if (manga.shouldScroll) {
      pageRefs[manga.currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      manga.shouldScroll = false;
    }
  });

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (manga.currentPage < pageUrls.length - 1) {
        manga.currentPage++;
        pageRefs[manga.currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      if (manga.currentPage > 0) {
        manga.currentPage--;
        pageRefs[manga.currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };
</script>

<svelte:window onkeydown={handleKey} />

<div
  bind:this={container}
  class="flex h-full flex-1 select-none flex-col overflow-y-auto py-4 gap-2"
>
  {#each pageUrls as src, i}
    <div
      bind:this={pageRefs[i]}
      class="flex w-full justify-center"
      use:intersect={(visible) => {
        if (visible) manga.currentPage = i;
      }}
    >
      <img {src} alt="manga page" loading="lazy" class="mx-auto" style="width: {manga.zoom * 100}%" />
    </div>
  {/each}
</div>
