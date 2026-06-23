<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter } from '$lib/chapter-loader';
  import { VIRTUAL_BUFFER, DEFAULT_PAGE_RATIO, INTERSECT_THRESHOLD } from '$lib/utils/constants';
  import { SvelteSet } from 'svelte/reactivity';
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
  let visibleSet = new SvelteSet<number>();

  const GAP = 8;
  const BUFFER_MARGIN_PX = 1500;

  $effect(() => {
    const len = chapter.pageUrls.length;
    ratios = Array(len).fill(DEFAULT_PAGE_RATIO);
    visibleSet.clear();
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

  let bufferObserver: IntersectionObserver | undefined;

  function setupBufferObserver() {
    bufferObserver?.disconnect();
    if (!containerEl) return;
    bufferObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.page);
          if (isNaN(idx)) continue;
          if (entry.isIntersecting) {
            visibleSet.add(idx);
          } else {
            visibleSet.delete(idx);
          }
        }
      },
      {
        root: containerEl,
        rootMargin: `${VIRTUAL_BUFFER * BUFFER_MARGIN_PX}px 0px`
      }
    );
  }

  let pageObserver: IntersectionObserver | undefined;

  function setupPageObserver() {
    pageObserver?.disconnect();
    if (!containerEl) return;
    pageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.boundingClientRect.height === 0) continue;
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.page);
            if (!isNaN(idx)) manga.currentPage = idx;
          }
        }
      },
      {
        root: containerEl,
        threshold: INTERSECT_THRESHOLD
      }
    );
  }

  $effect(() => {
    if (!containerEl) return;
    setupBufferObserver();
    setupPageObserver();
    return () => {
      bufferObserver?.disconnect();
      pageObserver?.disconnect();
    };
  });

  let slotEls: (HTMLDivElement | undefined)[] = $state([]);

  $effect(() => {
    if (!bufferObserver || !pageObserver) return;
    const len = chapter.pageUrls.length;
    for (let i = 0; i < len; i++) {
      const el = slotEls[i];
      if (el) {
        bufferObserver.observe(el);
        pageObserver.observe(el);
      }
    }
    return () => {
      bufferObserver?.disconnect();
      pageObserver?.disconnect();
      setupBufferObserver();
      setupPageObserver();
    };
  });

  $effect(() => {
    if (!manga.shouldScroll) return;
    manga.shouldScroll = false;
    if (!containerEl) return;

    const idx = manga.currentPage;
    const offset = scrollOffsetFor(idx);

    visibleSet.add(idx);

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

  // Tap detection: pointerdown → pointerup with < 10px movement = tap
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
      <div
        bind:this={slotEls[i]}
        data-page={i}
        class="flex w-full justify-center"
        style="min-height: {pageHeight(i)}px"
      >
        {#if visibleSet.has(i)}
          <img
            {src}
            alt="Page {i + 1} of {chapter.pageUrls.length}"
            class="mx-auto"
            style="width: {manga.zoom * 100}%"
            onload={(e) => captureRatio(i, e)}
          />
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
