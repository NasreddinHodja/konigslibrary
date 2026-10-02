<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerProps } from './types';
  import { DEFAULT_PAGE_RATIO } from '$lib/utils/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import EndOfChapter from '$lib/chapters/EndOfChapter.svelte';

  let { chapter, commands = $bindable(), ontap }: ViewerProps = $props();

  const reader = getReaderContext();
  const { state: manga } = reader;

  let containerEl: HTMLDivElement | undefined = $state();
  let containerHeight = $state(0);
  let containerWidth = $state(0);
  // Height/width per page: a guess per chapter until each image loads.
  let ratios: number[] = $derived(Array(chapter.pageUrls.length).fill(DEFAULT_PAGE_RATIO));

  const GAP = 8;

  function pageHeight(i: number): number {
    return (ratios[i] ?? DEFAULT_PAGE_RATIO) * containerWidth * manga.zoom;
  }

  const topPad = $derived(
    chapter.pageUrls.length > 0 ? Math.max(0, (containerHeight - pageHeight(0)) / 2) : 0
  );

  function scrollOffsetFor(page: number): number {
    let offset = topPad;
    for (let i = 0; i < page; i++) {
      offset += pageHeight(i) + GAP;
    }
    offset += pageHeight(page) / 2 - containerHeight / 2;
    return Math.max(0, offset);
  }

  function captureRatio(i: number, e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      // Reassigned, not mutated: a derived isn't deeply reactive.
      const next = [...ratios];
      next[i] = img.naturalHeight / img.naturalWidth;
      ratios = next;
    }
  }

  const onScroll = () => {
    if (!containerEl) return;
    const mid = containerEl.scrollTop + containerEl.clientHeight * 0.5;
    let acc = topPad;
    for (let i = 0; i < chapter.pageUrls.length; i++) {
      acc += pageHeight(i) + GAP;
      if (acc > mid) {
        if (chapter.pageUrls[i]) manga.currentPage = i;
        break;
      }
    }
  };

  $effect(() => {
    if (!manga.shouldScroll) return;
    manga.shouldScroll = false;
    if (!containerEl) return;

    const idx = manga.currentPage;
    const offset = scrollOffsetFor(idx);

    requestAnimationFrame(() => {
      containerEl?.scrollTo({ top: offset });
    });
  });

  $effect(() => {
    if (!chapter.loading && chapter.pageUrls.length > 0) {
      manga.shouldScroll = true;
    }
  });

  // Keeps the current page in view when the zoom changes.
  let prevZoom = manga.zoom;
  $effect(() => {
    const z = manga.zoom;
    if (z === prevZoom) return;
    prevZoom = z;
    requestAnimationFrame(() => {
      if (!containerEl) return;
      containerEl.scrollTop = scrollOffsetFor(manga.currentPage);
    });
  });

  const scrollNext = () => {
    if (manga.currentPage < chapter.pageUrls.length - 1) {
      manga.currentPage++;
      containerEl?.scrollTo({
        top: scrollOffsetFor(manga.currentPage),
        behavior: 'smooth'
      });
    }
  };

  const scrollPrev = () => {
    if (manga.currentPage > 0) {
      manga.currentPage--;
      containerEl?.scrollTo({
        top: scrollOffsetFor(manga.currentPage),
        behavior: 'smooth'
      });
    }
  };

  commands = { nextPage: scrollNext, prevPage: scrollPrev };

  let tapStartX = 0;
  let tapStartY = 0;
  let tapMoved = false;

  function onPointerDown(e: PointerEvent) {
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapMoved = false;
  }

  function onPointerMove(e: PointerEvent) {
    if (Math.abs(e.clientX - tapStartX) > 10 || Math.abs(e.clientY - tapStartY) > 10) {
      tapMoved = true;
    }
  }

  function onPointerUp() {
    if (!tapMoved) ontap?.();
  }
</script>

<div
  bind:this={containerEl}
  bind:clientHeight={containerHeight}
  bind:clientWidth={containerWidth}
  class="mx-auto flex h-full w-full max-w-[900px] flex-col gap-2 overflow-y-auto py-4 select-none"
  role="region"
  aria-label="Manga pages"
  onscroll={onScroll}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
>
  {#if chapter.loading}
    <Loader />
  {:else if chapter.error}
    <p class="py-8 text-center text-sm text-dim">Failed to load chapter: {chapter.error}</p>
  {:else}
    <div aria-hidden="true" style="height: {topPad}px; flex-shrink: 0"></div>
    {#each chapter.pageUrls as src, i (i)}
      <div data-page={i} class="flex w-full justify-center" style="min-height: {pageHeight(i)}px">
        {#if src}
          <img
            {src}
            alt="Page {i + 1} of {chapter.pageUrls.length}"
            class="mx-auto"
            style="width: {manga.zoom * 100}%"
            onload={(e) => captureRatio(i, e)}
          />
        {:else}
          <div
            class="flex items-center justify-center opacity-60"
            style="height: {pageHeight(i)}px"
          >
            <Loader />
          </div>
        {/if}
      </div>
    {/each}
    <EndOfChapter class="h-chapter-end select-text" />
  {/if}
</div>
