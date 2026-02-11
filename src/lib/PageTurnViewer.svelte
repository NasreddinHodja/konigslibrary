<script lang="ts">
  import { manga, getChapterFiles } from '$lib/state.svelte';
  import Spinner from '$lib/ui/Spinner.svelte';

  let pageUrls: string[] = $state([]);
  let loading = $state(false);
  let currentUrl: string | null = $derived(pageUrls[manga.currentPage] ?? null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- holds refs to prevent GC during preload
  let preloaded: HTMLImageElement[] = [];

  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    let cancelled = false;
    const urls: string[] = [];
    loading = true;
    pageUrls = [];

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
      loading = false;
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
      if (manga.rtl) next();
      else prev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (manga.rtl) prev();
      else next();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      prev();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      next();
    }
  };

  const handleClickLeft = () => {
    if (manga.rtl) next();
    else prev();
  };
  const handleClickRight = () => {
    if (manga.rtl) prev();
    else next();
  };
</script>

<svelte:window onkeydown={handleKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative flex h-full flex-1 items-center justify-center bg-black select-none">
  {#if loading}
    <Spinner />
  {:else}
    {#key manga.currentPage}
      {#if currentUrl}
        <img src={currentUrl} alt="manga page" class="max-h-full object-contain" />
      {/if}
    {/key}
  {/if}
  <div class="absolute inset-y-0 left-0 w-1/2 cursor-w-resize" onclick={handleClickLeft}></div>
  <div class="absolute inset-y-0 right-0 w-1/2 cursor-e-resize" onclick={handleClickRight}></div>
</div>
