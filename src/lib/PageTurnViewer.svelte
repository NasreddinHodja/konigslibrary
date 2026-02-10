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

      preloaded = urls.map((url) => {
        const img = new Image();
        img.src = url;
        img.decode().catch(() => {});
        return img;
      });
      pageUrls = urls;
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
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      manga.rtl ? next() : prev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      manga.rtl ? prev() : next();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      prev();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      next();
    }
  };

  const handleClickLeft = () => (manga.rtl ? next() : prev());
  const handleClickRight = () => (manga.rtl ? prev() : next());
</script>

<svelte:window onkeydown={handleKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative flex h-full flex-1 select-none items-center justify-center bg-black">
  {#key manga.currentPage}
    {#if currentUrl}
      <img src={currentUrl} alt="manga page" class="max-h-full object-contain" />
    {/if}
  {/key}
  <div class="absolute inset-y-0 left-0 w-1/2" class:cursor-e-resize={manga.rtl} class:cursor-w-resize={!manga.rtl} onclick={handleClickLeft}></div>
  <div class="absolute inset-y-0 right-0 w-1/2" class:cursor-w-resize={manga.rtl} class:cursor-e-resize={!manga.rtl} onclick={handleClickRight}></div>
</div>
