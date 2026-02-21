<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter } from '$lib/pipeline';
  import { VIRTUAL_BUFFER, DEFAULT_PAGE_RATIO, INTERSECT_THRESHOLD } from '$lib/utils/constants';
  import { SvelteSet } from 'svelte/reactivity';
  import Loader from '$lib/ui/Loader.svelte';

  let { commands = $bindable() }: { commands?: ViewerCommands | null } = $props();

  const svc = getReaderContext();
  const { state: manga } = svc;

  const chapter = useChapter(svc);

  let containerEl: HTMLDivElement | undefined = $state();
  let ratios: number[] = $state([]);
  let visibleSet = new SvelteSet<number>();

  const GAP = 8; // gap-2 = 0.5rem = 8px

  $effect(() => {
    const len = chapter.pageUrls.length;
    ratios = Array(len).fill(DEFAULT_PAGE_RATIO);
    visibleSet.clear();
  });

  function pageHeight(i: number): number {
    if (!containerEl) return 0;
    const w = containerEl.clientWidth;
    return (ratios[i] ?? DEFAULT_PAGE_RATIO) * w * manga.zoom;
  }

  function scrollOffsetFor(page: number): number {
    let offset = 0;
    for (let i = 0; i < page; i++) {
      offset += pageHeight(i) + GAP;
    }
    return offset;
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
        rootMargin: `${VIRTUAL_BUFFER * 1500}px 0px`
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
      const ratio = containerEl.scrollTop / (containerEl.scrollHeight || 1);
      prevZoom = z;
      requestAnimationFrame(() => {
        if (!containerEl) return;
        containerEl.scrollTop = ratio * containerEl.scrollHeight;
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
</script>

<div
  bind:this={containerEl}
  class="flex h-full flex-1 flex-col gap-2 overflow-y-auto py-4 select-none"
>
  {#if chapter.loading}
    <Loader />
  {:else if chapter.error}
    <p class="py-8 text-center text-sm opacity-60">Failed to load chapter: {chapter.error}</p>
  {:else}
    {#each chapter.pageUrls as src, i (src)}
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
            onerror={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              img.style.display = 'none';
              img.insertAdjacentHTML(
                'afterend',
                '<p class="py-8 text-sm opacity-40">Failed to load page</p>'
              );
            }}
          />
        {/if}
      </div>
    {/each}
  {/if}
</div>
