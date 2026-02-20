<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter, usePreloader, decodeMw, wideDetectMw } from '$lib/pipeline';
  import { PAGE_TURN_ZOOM } from '$lib/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import EndOfChapter from '$lib/EndOfChapter.svelte';

  let { commands = $bindable() }: { commands?: ViewerCommands | null } = $props();

  const svc = getReaderContext();
  const { state: manga } = svc;

  const chapter = useChapter(svc, [decodeMw, wideDetectMw]);
  // Preloader runs side effects (keeps nearby images decoded); cache not referenced directly
  usePreloader(
    manga,
    () => chapter.pageUrls,
    () => chapter.loading,
    () => chapter.decoded
  );

  let showEndScreen = $state(false);

  // Reset end screen on chapter change
  $effect(() => {
    manga.selectedChapter; // eslint-disable-line @typescript-eslint/no-unused-expressions
    showEndScreen = false;
  });

  let spreads: number[][] = $derived.by(() => {
    const result: number[][] = [];
    if (!manga.doublePage) {
      for (let i = 0; i < chapter.pageUrls.length; i++) result.push([i]);
      return result;
    }
    let i = 0;
    while (i < chapter.pageUrls.length) {
      if (chapter.widePages.has(i)) {
        result.push([i]);
        i++;
      } else if (i + 1 < chapter.pageUrls.length && !chapter.widePages.has(i + 1)) {
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

  commands = {
    nextPage: next,
    prevPage: prev,
    holdZoom(held: boolean) {
      zoomHeld = held;
      if (held && spreadEl) spreadRect = spreadEl.getBoundingClientRect();
    }
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

<div
  class="relative flex h-full flex-1 items-center justify-center bg-black select-none"
  class:overflow-hidden={zoomHeld}
  onmousemove={handleMouseMove}
  role="img"
  aria-label="Page {manga.currentPage + 1} of {chapter.pageUrls.length}"
>
  {#if chapter.loading}
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
          src={chapter.pageUrls[pageIdx]}
          alt="Page {pageIdx + 1} of {chapter.pageUrls.length}"
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
