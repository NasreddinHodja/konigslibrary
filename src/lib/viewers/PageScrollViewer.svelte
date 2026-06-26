<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter } from '$lib/chapter-loader';
  import { DEFAULT_PAGE_RATIO } from '$lib/utils/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { ChevronRight } from 'lucide-svelte';

  let { commands = $bindable(), ontap }: { commands?: ViewerCommands | null; ontap?: () => void } =
    $props();

  const reader = getReaderContext();
  const { state: manga } = reader;

  const chapter = useChapter(reader);

  $effect(() => {
    manga.pageUrls = chapter.pageUrls;
  });

  let containerEl: HTMLDivElement | undefined = $state();
  let containerHeight = $state(0);
  let containerWidth = $state(0);
  let ratios: number[] = $state([]);

  const GAP = 8;

  $effect(() => {
    const len = chapter.pageUrls.length;
    ratios = Array(len).fill(DEFAULT_PAGE_RATIO);
  });

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
      ratios[i] = img.naturalHeight / img.naturalWidth;
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

  let prevZoom = $state(manga.zoom);
  $effect(() => {
    const z = manga.zoom;
    if (z !== prevZoom && containerEl) {
      prevZoom = z;
      requestAnimationFrame(() => {
        if (!containerEl) return;
        containerEl.scrollTop = scrollOffsetFor(manga.currentPage);
      });
    }
    prevZoom = z;
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

  const nextChapter = $derived(reader.getNextChapter());

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
    <p class="py-8 text-center text-sm opacity-60">Failed to load chapter: {chapter.error}</p>
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
            class="flex items-center justify-center opacity-40"
            style="height: {pageHeight(i)}px"
          >
            <Loader />
          </div>
        {/if}
      </div>
    {/each}
    <div class="grid h-chapter-end w-full place-items-center select-text">
      <div class="flex flex-col items-center gap-4">
        <p class="text-lg opacity-50">End of {manga.selectedChapter}</p>
        {#if nextChapter}
          <Button size="lg" variant="primary" onclick={() => reader.goToNextChapter()}>
            {nextChapter}
            <ChevronRight size={16} />
          </Button>
        {:else}
          <span class="text-sm opacity-50">No next chapter</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
