<script lang="ts">
  import { manga, getChapterFiles } from '$lib/state.svelte';

  let pageUrls: string[] = $state([]);
  let currentUrl: string | null = $derived(pageUrls[manga.currentPage] ?? null);
  let preloaded: HTMLImageElement[] = [];

  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    let cancelled = false;
    const urls: string[] = [];

    getChapterFiles(chapter).then((blobs) => {
      if (cancelled) return;
      for (const blob of blobs) urls.push(URL.createObjectURL(blob));
      // Preload and fully decode all images so page turns are instant
      preloaded = urls.map((url) => {
        const img = new Image();
        img.src = url;
        img.decode().catch(() => {});
        return img;
      });
      pageUrls = urls;
      manga.currentPage = 0;
    });

    return () => {
      cancelled = true;
      preloaded = [];
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  const prev = () => {
    if (manga.currentPage > 0) manga.currentPage--;
  };

  const next = () => {
    if (manga.currentPage < pageUrls.length - 1) manga.currentPage++;
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      prev();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      next();
    }
  };

  const handleClick = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.clientX < rect.left + rect.width / 2) {
      prev();
    } else {
      next();
    }
  };
</script>

<svelte:window onkeydown={handleKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex h-full flex-1 cursor-pointer select-none items-center justify-center bg-black"
  onclick={handleClick}
>
  {#key manga.currentPage}
    {#if currentUrl}
      <img src={currentUrl} alt="manga page" class="max-h-full object-contain" />
    {/if}
  {/key}
</div>
