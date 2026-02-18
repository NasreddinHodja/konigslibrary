<script lang="ts">
  import { manga, getChapterUrls } from '$lib/state.svelte';
  import { resolveKey } from '$lib/keybindings.svelte';
  import { PAGE_TURN_ZOOM } from '$lib/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import EndOfChapter from '$lib/EndOfChapter.svelte';

  const PRELOAD_AHEAD = 5;
  const PRELOAD_BEHIND = 2;

  let pageUrls: string[] = $state([]);
  let loading = $state(false);
  let widePages: Set<number> = $state.raw(new Set());
  let showEndScreen = $state(false);

  // Sliding window: decoded Image objects keyed by page index (prevents GC of bitmaps)
  const preloadCache = new Map<number, HTMLImageElement>(); // eslint-disable-line svelte/prefer-svelte-reactivity

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

  // DOM window: current spread ± 1 spread for instant page turns
  let domPages: number[] = $derived.by(() => {
    if (spreads.length === 0) return [];
    const start = Math.max(0, currentSpreadIdx - 1);
    const end = Math.min(spreads.length - 1, currentSpreadIdx + 1);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) {
      for (const p of spreads[i]) pages.push(p);
    }
    return pages;
  });

  // Chapter load: decode first spread immediately, then background wide detection
  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    let cancelled = false;
    let revoke = false;
    let urls: string[] = [];
    loading = true;
    pageUrls = [];
    widePages = new Set();
    preloadCache.clear();
    showEndScreen = false;

    getChapterUrls(chapter).then(async (result) => {
      if (cancelled) return;
      urls = result.urls;
      revoke = result.revoke;

      // Decode only the initial spread for instant display
      const startPage = Math.max(0, Math.min(manga.currentPage, urls.length - 1));
      const initialPages = [startPage];
      if (manga.doublePage && startPage + 1 < urls.length) {
        initialPages.push(startPage + 1);
      }

      for (const idx of initialPages) {
        const img = new Image();
        img.src = urls[idx];
        try {
          await img.decode();
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        preloadCache.set(idx, img);
      }

      pageUrls = urls;
      loading = false;

      // Background: detect wide pages sequentially (low memory)
      if (manga.doublePage && urls.length > 0) {
        const wide = new Set<number>(); // eslint-disable-line svelte/prefer-svelte-reactivity
        for (let i = 0; i < urls.length; i++) {
          if (cancelled) return;
          let img = preloadCache.get(i);
          if (!img) {
            img = new Image();
            img.src = urls[i];
            try {
              await img.decode();
            } catch {
              /* ignore */
            }
          }
          if (img.naturalWidth > img.naturalHeight) wide.add(i);
        }
        if (!cancelled) widePages = wide;
      }
    });

    return () => {
      cancelled = true;
      preloadCache.clear();
      if (revoke) urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  // Sliding window preload: keep nearby pages decoded
  $effect(() => {
    if (loading || pageUrls.length === 0) return;
    const current = manga.currentPage;
    const urls = pageUrls;
    const start = Math.max(0, current - PRELOAD_BEHIND);
    const end = Math.min(urls.length - 1, current + PRELOAD_AHEAD);

    for (let i = start; i <= end; i++) {
      if (!preloadCache.has(i)) {
        const img = new Image();
        img.src = urls[i];
        img.decode().catch(() => {});
        preloadCache.set(i, img);
      }
    }

    for (const [idx] of preloadCache) {
      if (idx < start || idx > end) {
        preloadCache.delete(idx);
      }
    }
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
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const action = resolveKey(event.key);
    if (action === 'holdZoom') {
      zoomHeld = true;
      if (spreadEl) spreadRect = spreadEl.getBoundingClientRect();
      return;
    }
    if (zoomHeld) return;
    if (action === 'nextPage') {
      event.preventDefault();
      next();
    } else if (action === 'prevPage') {
      event.preventDefault();
      prev();
    } else if (action === 'nextPageRTL') {
      event.preventDefault();
      if (manga.rtl) prev();
      else next();
    } else if (action === 'prevPageRTL') {
      event.preventDefault();
      if (manga.rtl) next();
      else prev();
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (resolveKey(event.key) === 'holdZoom') zoomHeld = false;
  };

  const handleBlur = () => {
    zoomHeld = false;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!zoomHeld) return;
    clientX = event.clientX;
    clientY = event.clientY;
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
    <div
      bind:this={spreadEl}
      class="flex h-full items-center justify-center transition-transform duration-150 ease-out"
      style:flex-direction={manga.rtl ? 'row-reverse' : 'row'}
      style:transform={zoomHeld ? `scale(${PAGE_TURN_ZOOM})` : 'none'}
      style:transform-origin="{originX}% {originY}%"
    >
      {#each domPages as pageIdx (pageIdx)}
        <img
          src={pageUrls[pageIdx]}
          alt="Page {pageIdx + 1} of {pageUrls.length}"
          hidden={!currentSpread.includes(pageIdx)}
          class="max-h-full object-contain"
          class:max-w-[50%]={currentSpread.length === 2}
        />
      {/each}
    </div>
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
