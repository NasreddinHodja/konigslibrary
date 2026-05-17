<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter, usePreloader, decodeMw } from '$lib/pipeline';
  import { PAGE_TURN_ZOOM } from '$lib/utils/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import EndOfChapter from '$lib/chapters/EndOfChapter.svelte';

  let {
    commands = $bindable(),
    ontap
  }: { commands?: ViewerCommands | null; ontap?: () => void } = $props();

  const svc = getReaderContext();
  const { state: manga } = svc;

  const chapter = useChapter(svc, [decodeMw]);
  usePreloader(
    manga,
    () => chapter.pageUrls,
    () => chapter.loading,
    () => chapter.decoded
  );

  let showEndScreen = $state(false);

  $effect(() => {
    manga.selectedChapter; // eslint-disable-line @typescript-eslint/no-unused-expressions
    showEndScreen = false;
  });

  let domPages: number[] = $derived.by(() => {
    const len = chapter.pageUrls.length;
    if (len === 0) return [];
    const cur = manga.currentPage;
    const pages: number[] = [];
    if (cur > 0) pages.push(cur - 1);
    pages.push(cur);
    if (cur + 1 < len) pages.push(cur + 1);
    return pages;
  });

  const prev = () => {
    if (showEndScreen) {
      showEndScreen = false;
      return;
    }
    if (manga.currentPage > 0) {
      manga.currentPage--;
    }
  };

  const next = () => {
    if (showEndScreen) return;
    if (manga.currentPage < chapter.pageUrls.length - 1) {
      manga.currentPage++;
    } else {
      showEndScreen = true;
    }
  };

  let zoomHeld = $state(false);
  let pageEl: HTMLDivElement | undefined = $state();
  let pageRect: DOMRect | null = $state(null);
  let clientX = $state(0);
  let clientY = $state(0);

  let originX = $derived.by(() => {
    const r = pageRect;
    return r ? ((clientX - r.left) / r.width) * 100 : 50;
  });
  let originY = $derived.by(() => {
    const r = pageRect;
    return r ? ((clientY - r.top) / r.height) * 100 : 50;
  });

  commands = {
    nextPage: next,
    prevPage: prev,
    holdZoom(held: boolean) {
      zoomHeld = held;
      if (held && pageEl) pageRect = pageEl.getBoundingClientRect();
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

  const handleClickCenter = () => {
    if (zoomHeld) return;
    ontap?.();
  };

</script>

<div
  class="relative flex h-full flex-1 items-center justify-center bg-black select-none"
  style="padding-bottom: calc(var(--safe-bottom) - var(--safe-top))"
  class:overflow-hidden={zoomHeld}
  onmousemove={handleMouseMove}
  role="region"
  aria-label="Page {manga.currentPage + 1} of {chapter.pageUrls.length}"
>
  {#if chapter.loading}
    <Loader />
  {:else if chapter.error}
    <p class="py-8 text-center text-sm opacity-60">Failed to load chapter: {chapter.error}</p>
  {:else if showEndScreen}
    <EndOfChapter onback={() => (showEndScreen = false)} />
  {:else}
    <div
      bind:this={pageEl}
      class="flex h-full items-center justify-center transition-transform duration-150 ease-out"
      style:transform={zoomHeld ? `scale(${PAGE_TURN_ZOOM})` : undefined}
      style:transform-origin="{originX}% {originY}%"
    >
      {#each domPages as pageIdx (pageIdx)}
        <img
          src={chapter.pageUrls[pageIdx]}
          alt="Page {pageIdx + 1} of {chapter.pageUrls.length}"
          hidden={pageIdx !== manga.currentPage}
          class="max-h-full object-contain"
          onerror={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            img.style.display = 'none';
            const p = document.createElement('p');
            p.className = 'py-8 text-sm opacity-40';
            p.textContent = 'Failed to load page';
            img.insertAdjacentElement('afterend', p);
          }}
        />
      {/each}
    </div>
  {/if}

  {#if !showEndScreen}
    <!-- Left zone: previous page -->
    <button
      class="absolute inset-y-0 left-0 w-[40%]"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-w-resize={!zoomHeld}
      aria-label="Previous page"
      onclick={handleClickLeft}
    ></button>

    <!-- Center zone: toggle HUD -->
    <button
      class="absolute inset-y-0 left-[40%] w-[20%]"
      class:cursor-zoom-in={zoomHeld}
      aria-label="Toggle menu"
      onclick={handleClickCenter}
    ></button>

    <!-- Right zone: next page -->
    <button
      class="absolute inset-y-0 right-0 w-[40%]"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-e-resize={!zoomHeld}
      aria-label="Next page"
      onclick={handleClickRight}
    ></button>
  {/if}
</div>
