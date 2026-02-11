<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { manga, getChapterFiles } from '$lib/state.svelte';
  import Spinner from '$lib/ui/Spinner.svelte';

  let pageUrls: string[] = $state([]);
  let loading = $state(false);
  // eslint-disable-next-line svelte/no-unnecessary-state-wrap -- reassigned on chapter change
  let widePages: SvelteSet<number> = $state(new SvelteSet());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- holds refs to prevent GC during preload
  let preloaded: HTMLImageElement[] = [];

  let spreads: number[][] = $derived.by(() => {
    const result: number[][] = [];
    if (!manga.doublePage) {
      for (let i = 0; i < pageUrls.length; i++) result.push([i]);
      return result;
    }
    let i = 0;
    while (i < pageUrls.length) {
      if (widePages.has(i)) {
        result.push([i]);
        i++;
      } else if (i + 1 < pageUrls.length && !widePages.has(i + 1)) {
        result.push([i, i + 1]);
        i += 2;
      } else {
        result.push([i]);
        i++;
      }
    }
    return result;
  });

  let currentSpreadIdx: number = $derived(
    Math.max(
      0,
      spreads.findIndex((s) => s.includes(manga.currentPage))
    )
  );

  let currentSpread: number[] = $derived(spreads[currentSpreadIdx] ?? []);

  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    let cancelled = false;
    const urls: string[] = [];
    loading = true;
    pageUrls = [];
    widePages = new SvelteSet();

    getChapterFiles(chapter).then(async (blobs) => {
      if (cancelled) return;
      const imgs: HTMLImageElement[] = [];
      for (const blob of blobs) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = new Image();
        img.src = url;
        imgs.push(img);
      }

      await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
      if (cancelled) return;

      const wide = new SvelteSet<number>();
      for (let i = 0; i < imgs.length; i++) {
        if (imgs[i].naturalWidth > imgs[i].naturalHeight) wide.add(i);
      }

      preloaded = imgs;
      widePages = wide;
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
    if (currentSpreadIdx > 0) {
      manga.currentPage = spreads[currentSpreadIdx - 1][0];
    }
  };

  const next = () => {
    if (currentSpreadIdx < spreads.length - 1) {
      manga.currentPage = spreads[currentSpreadIdx + 1][0];
    }
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
    {#key currentSpreadIdx}
      <div
        class="flex h-full items-center justify-center"
        style:flex-direction={manga.rtl ? 'row-reverse' : 'row'}
      >
        {#each currentSpread as pageIdx (pageIdx)}
          <img
            src={pageUrls[pageIdx]}
            alt="manga page"
            class="max-h-full object-contain"
            class:max-w-[50%]={currentSpread.length === 2}
          />
        {/each}
      </div>
    {/key}
  {/if}
  <div class="absolute inset-y-0 left-0 w-1/2 cursor-w-resize" onclick={handleClickLeft}></div>
  <div class="absolute inset-y-0 right-0 w-1/2 cursor-e-resize" onclick={handleClickRight}></div>
</div>
