<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { manga, getChapterUrls } from '$lib/state.svelte';
  import { PAGE_TURN_ZOOM } from '$lib/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import EndOfChapter from '$lib/EndOfChapter.svelte';

  let pageUrls: string[] = $state([]);
  let loading = $state(false);
  // eslint-disable-next-line svelte/no-unnecessary-state-wrap -- reassigned on chapter change
  let widePages: SvelteSet<number> = $state(new SvelteSet());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- prevents GC during preload
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
  let showEndScreen = $state(false);

  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    let cancelled = false;
    let revoke = false;
    let urls: string[] = [];
    loading = true;
    pageUrls = [];
    widePages = new SvelteSet();
    showEndScreen = false;

    getChapterUrls(chapter).then(async (result) => {
      if (cancelled) return;
      urls = result.urls;
      revoke = result.revoke;

      const imgs: HTMLImageElement[] = [];
      for (const url of urls) {
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
      if (revoke) urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  const prev = () => {
    if (showEndScreen) {
      showEndScreen = false;
      return;
    }
    if (currentSpreadIdx > 0) {
      manga.currentPage = spreads[currentSpreadIdx - 1][0];
    }
  };

  const next = () => {
    if (showEndScreen) return;
    if (currentSpreadIdx < spreads.length - 1) {
      manga.currentPage = spreads[currentSpreadIdx + 1][0];
    } else if (currentSpreadIdx === spreads.length - 1) {
      showEndScreen = true;
    }
  };

  let zoomHeld = $state(false);
  let spreadEl: HTMLDivElement | undefined = $state();
  let spreadRect: DOMRect | null = $state(null);
  let clientX = $state(0);
  let clientY = $state(0);

  let originX = $derived.by(() => {
    const r = spreadRect;
    return r ? ((clientX - r.left) / r.width) * 100 : 50;
  });
  let originY = $derived.by(() => {
    const r = spreadRect;
    return r ? ((clientY - r.top) / r.height) * 100 : 50;
  });

  const handleKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'z') {
      zoomHeld = true;
      return;
    }
    if (zoomHeld) return;
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

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'z') zoomHeld = false;
  };

  const handleBlur = () => {
    zoomHeld = false;
  };

  const handleMouseMove = (event: MouseEvent) => {
    clientX = event.clientX;
    clientY = event.clientY;
    if (!zoomHeld && spreadEl) {
      spreadRect = spreadEl.getBoundingClientRect();
    }
  };

  const handleClickLeft = () => {
    if (zoomHeld) return;
    if (manga.rtl) next();
    else prev();
  };
  const handleClickRight = () => {
    if (zoomHeld) return;
    if (manga.rtl) prev();
    else next();
  };
</script>

<svelte:window onkeydown={handleKey} onkeyup={handleKeyUp} onblur={handleBlur} />

<div
  class="relative flex h-full flex-1 items-center justify-center bg-black select-none"
  class:overflow-hidden={zoomHeld}
  onmousemove={handleMouseMove}
  role="img"
  aria-label="Page {manga.currentPage + 1} of {pageUrls.length}"
>
  {#if loading}
    <Loader />
  {:else if showEndScreen}
    <EndOfChapter onback={() => (showEndScreen = false)} />
  {:else}
    {#key currentSpreadIdx}
      <div
        bind:this={spreadEl}
        class="flex h-full items-center justify-center transition-transform duration-150 ease-out"
        style:flex-direction={manga.rtl ? 'row-reverse' : 'row'}
        style:transform={zoomHeld ? `scale(${PAGE_TURN_ZOOM})` : 'none'}
        style:transform-origin="{originX}% {originY}%"
      >
        {#each currentSpread as pageIdx (pageIdx)}
          <img
            src={pageUrls[pageIdx]}
            alt="Page {pageIdx + 1} of {pageUrls.length}"
            class="max-h-full object-contain"
            class:max-w-[50%]={currentSpread.length === 2}
          />
        {/each}
      </div>
    {/key}
  {/if}
  {#if !showEndScreen}
    <button
      class="absolute inset-y-0 left-0 w-1/2"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-w-resize={!zoomHeld}
      aria-label="Previous page"
      onclick={handleClickLeft}
    ></button>
    <button
      class="absolute inset-y-0 right-0 w-1/2"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-e-resize={!zoomHeld}
      aria-label="Next page"
      onclick={handleClickRight}
    ></button>
  {/if}
</div>
