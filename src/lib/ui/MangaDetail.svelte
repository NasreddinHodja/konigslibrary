<script lang="ts">
  import { tick } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import { ArrowLeft, Search, X, BookOpen } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import Loader from '$lib/ui/Loader.svelte';
  import { createVirtualizer, createWindowVirtualizer } from '@tanstack/svelte-virtual';
  import type { VirtualItem } from '@tanstack/virtual-core';
  import { getReaderContext } from '$lib/context';
  import { searchManga, searchMangaMultiple } from '$lib/api/anilist';
  import type { MangaMeta } from '$lib/api/anilist';
  import { fetchLatestChapter } from '$lib/api/mangadex';

  const svc = getReaderContext();
  const { state: manga } = svc;

  const mangaName = $derived(svc.provider?.mangaName ?? '');
  const chapters = $derived(svc.chapters);
  const savedProgress = $derived(svc.getSavedProgress());

  let meta: MangaMeta | null = $state(null);
  let metaError = $state(false);
  let coverFailed = $state(false);
  let search = $state('');

  let authorsExpanded = $state(false);
  let authorsTruncated = $state(false);
  let authorsEl: HTMLSpanElement | undefined = $state();
  let tagsExpanded = $state(false);
  let tagsEl: HTMLDivElement | undefined = $state();
  let tagsCollapsedH = 0;

  async function expandTags() {
    if (!tagsEl) {
      tagsExpanded = true;
      return;
    }
    tagsCollapsedH = tagsEl.scrollHeight;
    tagsEl.style.height = tagsCollapsedH + 'px';
    tagsEl.style.overflow = 'hidden';
    tagsExpanded = true;
    await tick();
    const to = tagsEl.scrollHeight;
    requestAnimationFrame(() => {
      if (!tagsEl) return;
      tagsEl.style.transition = `height ${ANIM_DURATION}ms ease-out`;
      tagsEl.style.height = to + 'px';
      setTimeout(() => {
        if (tagsEl) resetTagsStyle(tagsEl);
      }, ANIM_DURATION + 20);
    });
  }

  function collapseTags() {
    if (!tagsEl) {
      tagsExpanded = false;
      return;
    }
    tagsEl.style.height = tagsEl.scrollHeight + 'px';
    tagsEl.style.overflow = 'hidden';
    void tagsEl.offsetHeight; // force reflow so the browser registers the starting height
    tagsEl.style.transition = `height ${ANIM_DURATION}ms ease-out`;
    tagsEl.style.height = tagsCollapsedH + 'px';
    setTimeout(() => {
      tagsExpanded = false;
      tick().then(() => {
        if (tagsEl) resetTagsStyle(tagsEl);
      });
    }, ANIM_DURATION + 20);
  }

  function resetTagsStyle(el: HTMLDivElement) {
    el.style.height = '';
    el.style.overflow = '';
    el.style.transition = '';
  }

  let pickerOpen = $state(false);
  let pickerQuery = $state('');
  let pickerLoading = $state(false);
  let pickerResults: MangaMeta[] = $state([]);
  let pickerError = $state(false);

  async function runPickerSearch() {
    if (!pickerQuery.trim()) return;
    pickerLoading = true;
    pickerError = false;
    pickerResults = [];
    try {
      pickerResults = await searchMangaMultiple(pickerQuery.trim(), 6);
      if (!pickerResults.length) pickerError = true;
    } catch {
      pickerError = true;
    } finally {
      pickerLoading = false;
    }
  }

  function selectFromPicker(result: MangaMeta) {
    meta = result;
    metaError = false;
    pickerOpen = false;
    pickerQuery = '';
    pickerResults = [];
  }

  function openPicker() {
    pickerOpen = true;
    pickerQuery = mangaName;
    pickerResults = [];
    pickerError = false;
  }

  $effect(() => {
    if (!pickerOpen) return;
    const query = pickerQuery.trim();
    if (!query) {
      pickerResults = [];
      return;
    }
    const t = setTimeout(() => runPickerSearch(), 350);
    return () => clearTimeout(t);
  });

  const filteredChapters = $derived(
    search.trim()
      ? chapters.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
      : chapters
  );

  const ROW_H = 48;

  // Mobile: window-based virtualizer (page scrolls naturally).
  // Bug: with a large scrollMargin, the default overscan=5 doesn't render enough
  // items to fill the viewport — the formula undershoots by scrollMargin/ROW_H items.
  // Fix: bump overscan by ceil(scrollMargin/ROW_H) so items are always rendered.
  let listEl = $state<HTMLDivElement | undefined>();
  let chapterSentinelEl = $state<HTMLDivElement | undefined>();
  let chapterHeaderStuck = $state(false);

  $effect(() => {
    if (!chapterSentinelEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => { chapterHeaderStuck = !entry.isIntersecting; },
      { threshold: 0 }
    );
    observer.observe(chapterSentinelEl);
    return () => observer.disconnect();
  });
  let scrollMargin = $state(0);

  function updateScrollMargin() {
    if (listEl) scrollMargin = listEl.getBoundingClientRect().top + window.scrollY;
  }

  $effect(() => {
    if (!listEl) return;
    updateScrollMargin();
    window.addEventListener('resize', updateScrollMargin);
    const rafId = requestAnimationFrame(() => {
      updateScrollMargin();
      window.dispatchEvent(new Event('resize'));
    });
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateScrollMargin);
    };
  });

  $effect(() => {
    void meta;
    requestAnimationFrame(updateScrollMargin);
  });

  let mobileVirtualItems = $state<VirtualItem[]>([]);
  let mobileTotalSize = $state(0);

  $effect(() => {
    void scrollMargin;
    const overscan = 5 + Math.ceil(scrollMargin / ROW_H);
    const store = createWindowVirtualizer({
      count: filteredChapters.length,
      estimateSize: () => ROW_H,
      overscan,
      scrollMargin
    });
    const unsub = store.subscribe((v) => {
      mobileVirtualItems = v.getVirtualItems();
      mobileTotalSize = v.getTotalSize();
    });
    return unsub;
  });

  // Desktop: container-based virtualizer
  let isDesktop = $state(false);
  let desktopScrollEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    isDesktop = mq.matches;
    const handler = (e: MediaQueryListEvent) => (isDesktop = e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  let desktopVirtualItems = $state<VirtualItem[]>([]);
  let desktopTotalSize = $state(0);

  $effect(() => {
    void desktopScrollEl;
    const store = createVirtualizer({
      count: filteredChapters.length,
      estimateSize: () => ROW_H,
      overscan: 5,
      getScrollElement: () => desktopScrollEl ?? null
    });
    const unsub = store.subscribe((v) => {
      desktopVirtualItems = v.getVirtualItems();
      desktopTotalSize = v.getTotalSize();
    });
    return unsub;
  });

  $effect(() => {
    if (!authorsEl || authorsExpanded) return;
    authorsTruncated = authorsEl.scrollWidth > authorsEl.clientWidth;
  });

  const TAGS_COLLAPSED = 4;

  $effect(() => {
    if (!mangaName) return;
    meta = null;
    metaError = false;
    coverFailed = false;
    authorsExpanded = false;
    authorsTruncated = false;
    tagsExpanded = false;
    searchManga(mangaName)
      .then(async (result) => {
        if (!result) {
          metaError = true;
          return;
        }
        meta = result;
        if (result.status === 'ongoing' && result.mangadexId) {
          const latest = await fetchLatestChapter(result.mangadexId);
          if (latest && meta) {
            meta = { ...meta, latestChapter: latest.chapter, latestChapterDate: latest.publishAt };
          }
        }
      })
      .catch(() => {
        metaError = true;
      });
  });

  function resume() {
    if (!savedProgress) return;
    manga.selectedChapter = savedProgress.chapter;
    manga.currentPage = savedProgress.page;
    manga.shouldScroll = true;
  }

  function readChapter(name: string) {
    const progress = svc.getSavedProgress();
    manga.selectedChapter = name;
    if (progress?.chapter === name) {
      manga.currentPage = progress.page;
    } else {
      manga.currentPage = 0;
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  const STATUS_LABEL: Record<string, string> = {
    ongoing: 'ONGOING',
    completed: 'COMPLETED',
    hiatus: 'HIATUS',
    cancelled: 'CANCELLED'
  };
</script>

{#if isDesktop}
  <!-- Desktop: centered two-panel layout, no page scroll -->
  <div
    class="mx-auto flex max-w-5xl overflow-hidden"
    style="height: 100dvh; padding: max(2rem, var(--safe-top)) 2rem max(2rem, var(--safe-bottom))"
  >
    <!-- Left panel: manga details -->
    <div class="flex w-96 shrink-0 flex-col gap-6 overflow-y-auto pr-8">
      <!-- Back -->
      <div>
        <button
          class="flex cursor-pointer items-center gap-1.5 text-xs tracking-widest opacity-30 hover:opacity-80"
          onclick={svc.clearManga}
        >
          <ArrowLeft size={12} />
          LIBRARY
        </button>
      </div>

      {#if metaError && !meta}
        <div class="flex flex-col gap-4">
          <h1 class="text-xl leading-tight font-bold">{mangaName}</h1>
          {#if savedProgress}
            <button
              class="cursor-pointer self-start border-1 border-fg px-4 py-2 text-sm hover:bg-fg hover:text-bg"
              onclick={resume}
            >
              RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
            </button>
          {/if}
        </div>
      {:else}
        <!-- Cover then info stacked -->
        <div class="flex flex-col gap-6">
          <!-- Cover -->
          <div class="relative h-64 w-44">
            {#if meta?.coverUrl && !coverFailed}
              <img
                src={meta.coverUrl}
                alt={meta?.title ?? mangaName}
                class="absolute inset-0 h-full w-full object-contain object-left"
                onerror={() => (coverFailed = true)}
              />
            {:else}
              <Skeleton class="absolute inset-0" />
            {/if}
          </div>

          <!-- Info -->
          <div class="flex min-w-0 flex-1 flex-col">
            <h1 class="text-xl leading-tight font-bold">
              {meta?.title || mangaName}
            </h1>
            <p class="mt-0.5 text-xs opacity-30">{mangaName}</p>

            <div class="mt-3 flex flex-col gap-3">
              {#if meta}
                <div
                  class="flex flex-col gap-3"
                  in:fade={{ duration: ANIM_DURATION, delay: 50, easing: ANIM_EASE }}
                >
                  <div class="flex flex-wrap items-center gap-3">
                    {#if meta.status}
                      <span
                        class="border px-2 py-0.5 text-xs font-bold tracking-widest
                        {meta.status === 'ongoing'
                          ? 'border-success/50 text-success'
                          : 'border-fg/20 opacity-50'}"
                      >
                        {STATUS_LABEL[meta.status] ?? meta.status.toUpperCase()}
                      </span>
                    {/if}
                    {#if meta.year}
                      <span class="text-xs opacity-40">{meta.year}</span>
                    {/if}
                    {#if meta.authors.length}
                      <span class="truncate text-xs opacity-40">{meta.authors.join(', ')}</span>
                    {/if}
                  </div>

                  {#if meta.tags.length}
                    <div class="flex flex-wrap gap-1.5" bind:this={tagsEl}>
                      {#each meta.tags.slice(0, TAGS_COLLAPSED) as tag (tag)}
                        <span class="border border-fg/30 px-2 py-0.5 text-xs opacity-50">{tag}</span
                        >
                      {/each}
                      {#if tagsExpanded}
                        {#each meta.tags.slice(TAGS_COLLAPSED, 6) as tag (tag)}
                          <span class="border border-fg/30 px-2 py-0.5 text-xs opacity-50"
                            >{tag}</span
                          >
                        {/each}
                        <button
                          class="cursor-pointer border border-fg/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
                          onclick={collapseTags}>less</button
                        >
                      {:else if meta.tags.length > TAGS_COLLAPSED}
                        <button
                          class="cursor-pointer border border-fg/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
                          onclick={expandTags}>more</button
                        >
                      {/if}
                    </div>
                  {/if}

                  {#if meta.status === 'ongoing' && meta.latestChapter}
                    <div class="self-start border border-fg/10 px-3 py-2 text-xs">
                      <span class="opacity-40">Latest on MangaDex: </span>
                      <span class="">Ch. {meta.latestChapter}</span>
                      {#if meta.latestChapterDate}
                        <span class="opacity-30"> · {formatDate(meta.latestChapterDate)}</span>
                      {/if}
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="flex flex-col gap-3">
                  <div class="flex flex-wrap items-center gap-3">
                    <Skeleton class="h-[22px] w-20" />
                    <Skeleton class="h-[22px] w-8" />
                    <Skeleton class="h-[22px] w-32" />
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    {#each [60, 52, 56, 48] as w (w)}
                      <Skeleton class="h-[22px]" style="width: {w}px" />
                    {/each}
                  </div>
                </div>
              {/if}
            </div>

            <!-- Bottom actions -->
            <div class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
              {#if savedProgress}
                <button
                  class="cursor-pointer border-1 border-fg px-4 py-2 text-sm hover:bg-fg hover:text-bg"
                  onclick={resume}
                  in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
                >
                  RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
                </button>
              {/if}
              {#if !pickerOpen}
                <button
                  class="cursor-pointer text-xs underline opacity-30 hover:opacity-70
                    {meta ? '' : 'pointer-events-none invisible'}"
                  onclick={openPicker}
                  in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
                  out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
                >
                  Not this manga?
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Picker panel -->
      {#if pickerOpen && meta}
        <div
          class="overflow-hidden border border-fg/15 p-4"
          in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
          out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
        >
          <div class="mb-3 flex items-center justify-between">
            <span class="text-xs font-bold tracking-widest opacity-50">SEARCH ANILIST</span>
            <button
              class="cursor-pointer opacity-30 hover:opacity-80"
              onclick={() => (pickerOpen = false)}
            >
              <X size={12} />
            </button>
          </div>
          <div class="flex items-center gap-2 border border-fg/15 px-3 py-1.5">
            <Search size={12} class="shrink-0 opacity-30" />
            <input
              bind:value={pickerQuery}
              placeholder="Search title…"
              class="flex-1 bg-transparent text-sm outline-none placeholder:opacity-30"
            />
            {#if pickerLoading}
              <span class="text-xs opacity-30">…</span>
            {:else if pickerQuery}
              <button
                class="cursor-pointer opacity-30 hover:opacity-80"
                onclick={() => {
                  pickerQuery = '';
                  pickerResults = [];
                  pickerError = false;
                }}
              >
                <X size={12} />
              </button>
            {/if}
          </div>

          {#if pickerLoading}
            <div
              class="mt-3 overflow-hidden py-6"
              in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
              out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
            >
              <Loader />
            </div>
          {:else if pickerError}
            <p
              class="mt-3 overflow-hidden text-xs opacity-40"
              in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
              out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
            >
              No results found.
            </p>
          {:else if pickerResults.length}
            <ul
              class="mt-3 flex flex-col gap-0 overflow-hidden border border-fg/10"
              in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
              out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
            >
              {#each pickerResults as result (result.id)}
                <li class="border-b border-fg/10 last:border-b-0">
                  <button
                    class="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-fg/5"
                    onclick={() => selectFromPicker(result)}
                  >
                    {#if result.coverUrl}
                      <img
                        src={result.coverUrl}
                        alt={result.title}
                        class="h-12 w-9 shrink-0 object-cover opacity-80"
                      />
                    {:else}
                      <div
                        class="flex h-12 w-9 shrink-0 items-center justify-center border border-fg/10"
                      >
                        <BookOpen size={14} class="opacity-20" />
                      </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-bold">{result.title}</p>
                      <div class="mt-0.5 flex items-center gap-2 text-xs opacity-40">
                        {#if result.year}<span>{result.year}</span>{/if}
                        {#if result.status}<span>{result.status.toUpperCase()}</span>{/if}
                        {#if result.authors.length}<span class="truncate">{result.authors[0]}</span
                          >{/if}
                      </div>
                    </div>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Vertical divider -->
    <div class="border-l border-fg/10"></div>

    <!-- Right panel: chapter list -->
    <div class="flex min-h-0 flex-1 flex-col pl-8">
      <!-- Chapters header -->
      <div class="shrink-0 py-3">
        <div class="flex items-center gap-4">
          <span class="shrink-0 text-xs font-bold tracking-widest opacity-30">
            CHAPTERS ({chapters.length})
          </span>
          <div class="flex min-w-0 flex-1 items-center gap-2 border border-fg/15 px-3 py-1.5">
            <Search size={12} class="shrink-0 opacity-30" />
            <input
              bind:value={search}
              placeholder="Search chapters…"
              class="flex-1 bg-transparent text-sm outline-none placeholder:opacity-30"
            />
            {#if search}
              <button
                class="cursor-pointer opacity-30 hover:opacity-80"
                onclick={() => (search = '')}
              >
                <X size={12} />
              </button>
            {/if}
          </div>
        </div>
      </div>

      <!-- Scrollable virtual list -->
      <div bind:this={desktopScrollEl} class="min-h-0 flex-1 overflow-y-auto">
        {#if filteredChapters.length === 0}
          <p
            class="py-8 text-center text-xs opacity-30"
            in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
          >
            No chapters match "{search}"
          </p>
        {:else}
          <div style="height: {desktopTotalSize}px; position: relative;">
            {#each desktopVirtualItems as row (row.key)}
              {@const chapter = filteredChapters[row.index]}
              {@const isResume = savedProgress?.chapter === chapter.name}
              <button
                style="position: absolute; top: {row.start}px; left: 0; right: 0; height: {ROW_H}px;"
                class="flex w-full cursor-pointer items-center justify-between border-b border-fg/10 px-2 text-left hover:bg-fg/5"
                onclick={() => readChapter(chapter.name)}
              >
                <span class="truncate text-sm {isResume ? 'font-bold' : 'opacity-70'}"
                  >{chapter.name}</span
                >
                <div class="ml-4 flex shrink-0 items-center gap-3">
                  {#if isResume}
                    <span class="text-xs opacity-40">p.{savedProgress.page + 1}</span>
                  {/if}
                  <span class="text-xs opacity-30">{chapter.pageCount}p</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <div
    class="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6"
    style="padding-top: calc(1.5rem + var(--safe-top)); padding-bottom: calc(2rem + var(--safe-bottom))"
  >
    <!-- Back -->
    <div class="mb-6 flex items-center justify-between">
      <button
        class="flex cursor-pointer items-center gap-1.5 text-xs tracking-widest opacity-30 hover:opacity-80"
        onclick={svc.clearManga}
      >
        <ArrowLeft size={12} />
        LIBRARY
      </button>
    </div>

    {#if metaError && !meta}
      <!-- Empty state: title + resume only -->
      <div class="flex flex-col gap-4">
        <h1 class="text-xl leading-tight font-bold">{mangaName}</h1>
        {#if savedProgress}
          <button
            class="cursor-pointer self-start border-1 border-fg px-4 py-2 text-sm hover:bg-fg hover:text-bg"
            onclick={resume}
          >
            RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
          </button>
        {/if}
      </div>
    {:else}
      <!-- Cover + info side by side -->
      <div class="flex flex-col gap-6 sm:flex-row">
        <!-- Cover -->
        <div class="relative h-56 w-40 shrink-0 self-center sm:self-auto">
          {#if meta?.coverUrl && !coverFailed}
            <img
              src={meta.coverUrl}
              alt={meta?.title ?? mangaName}
              class="absolute inset-0 h-full w-full object-contain"
              onerror={() => (coverFailed = true)}
            />
          {:else}
            <Skeleton class="absolute inset-0" />
          {/if}
        </div>

        <!-- Info -->
        <div class="flex min-w-0 flex-1 flex-col sm:h-56">
          <h1 class="text-xl leading-tight font-bold">
            {meta?.title || mangaName}
          </h1>
          <p class="mt-0.5 text-xs opacity-30">{mangaName}</p>

          <div
            class="mt-3 flex min-h-[7rem] flex-col gap-3 sm:min-h-0 sm:flex-1 sm:overflow-hidden"
          >
            {#if meta}
              <div
                class="flex flex-col gap-3"
                in:fade={{ duration: ANIM_DURATION, delay: 50, easing: ANIM_EASE }}
              >
                <div class="flex flex-wrap items-center gap-3">
                  {#if meta.status}
                    <span
                      class="border px-2 py-0.5 text-xs font-bold tracking-widest
                      {meta.status === 'ongoing'
                        ? 'border-success/50 text-success'
                        : 'border-fg/20 opacity-50'}"
                    >
                      {STATUS_LABEL[meta.status] ?? meta.status.toUpperCase()}
                    </span>
                  {/if}
                  {#if meta.year}
                    <span class="text-xs opacity-40">{meta.year}</span>
                  {/if}
                  {#if meta.authors.length}
                    <span class="hidden text-xs opacity-40 sm:inline"
                      >{meta.authors.join(', ')}</span
                    >
                  {/if}
                </div>

                {#if meta.authors.length}
                  <div class="flex flex-col gap-1 sm:hidden">
                    {#if !authorsExpanded}
                      <div class="flex items-center gap-1.5">
                        <span bind:this={authorsEl} class="min-w-0 truncate text-xs opacity-40"
                          >{meta.authors.join(', ')}</span
                        >
                        {#if authorsTruncated}
                          <button
                            class="shrink-0 cursor-pointer border border-fg/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
                            onclick={() => (authorsExpanded = true)}>more</button
                          >
                        {/if}
                      </div>
                    {/if}
                    {#if authorsExpanded}
                      <div
                        class="overflow-hidden text-xs opacity-40"
                        in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
                        out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
                      >
                        {meta.authors.join(', ')}
                        <button
                          class="cursor-pointer border border-fg/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
                          onclick={() => (authorsExpanded = false)}>less</button
                        >
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if meta.tags.length}
                  <div class="flex flex-wrap gap-1.5" bind:this={tagsEl}>
                    {#each meta.tags.slice(0, TAGS_COLLAPSED) as tag (tag)}
                      <span class="border border-fg/30 px-2 py-0.5 text-xs opacity-50">{tag}</span>
                    {/each}
                    {#if tagsExpanded}
                      {#each meta.tags.slice(TAGS_COLLAPSED, 6) as tag (tag)}
                        <span class="border border-fg/30 px-2 py-0.5 text-xs opacity-50">{tag}</span
                        >
                      {/each}
                      <button
                        class="cursor-pointer border border-fg/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
                        onclick={collapseTags}>less</button
                      >
                    {:else if meta.tags.length > TAGS_COLLAPSED}
                      <button
                        class="cursor-pointer border border-fg/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
                        onclick={expandTags}>more</button
                      >
                    {/if}
                  </div>
                {/if}

                {#if meta.status === 'ongoing' && meta.latestChapter}
                  <div class="self-start border border-fg/10 px-3 py-2 text-xs">
                    <span class="opacity-40">Latest on MangaDex: </span>
                    <span class="">Ch. {meta.latestChapter}</span>
                    {#if meta.latestChapterDate}
                      <span class="opacity-30"> · {formatDate(meta.latestChapterDate)}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <div class="flex flex-col gap-3">
                <div class="flex flex-wrap items-center gap-3">
                  <Skeleton class="h-[22px] w-20" />
                  <Skeleton class="h-[22px] w-8" />
                  <Skeleton class="hidden h-[22px] w-32 sm:block" />
                </div>
                <Skeleton class="h-4 w-40 sm:hidden" />
                <div class="flex flex-wrap gap-1.5">
                  {#each [60, 52, 56, 48] as w (w)}
                    <Skeleton class="h-[22px]" style="width: {w}px" />
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <!-- Bottom actions: resume + not this manga, pinned to bottom -->
          <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mt-auto sm:pt-3">
            {#if savedProgress}
              <button
                class="cursor-pointer border-1 border-fg px-4 py-2 text-sm hover:bg-fg hover:text-bg"
                onclick={resume}
                in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
              >
                RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
              </button>
            {/if}
            {#if !pickerOpen}
              <button
                class="cursor-pointer text-xs underline opacity-30 hover:opacity-70
                  {meta ? '' : 'pointer-events-none invisible'}"
                onclick={openPicker}
                in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
                out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
              >
                Not this manga?
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Picker panel (outside fixed section) -->
    {#if pickerOpen && meta}
      <div
        class="mt-4 overflow-hidden border border-fg/15 p-4"
        in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
        out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
      >
        <div class="mb-3 flex items-center justify-between">
          <span class="text-xs font-bold tracking-widest opacity-50">SEARCH ANILIST</span>
          <button
            class="cursor-pointer opacity-30 hover:opacity-80"
            onclick={() => (pickerOpen = false)}
          >
            <X size={12} />
          </button>
        </div>
        <div class="flex items-center gap-2 border border-fg/15 px-3 py-1.5">
          <Search size={12} class="shrink-0 opacity-30" />
          <input
            bind:value={pickerQuery}
            placeholder="Search title…"
            class="flex-1 bg-transparent text-sm outline-none placeholder:opacity-30"
          />
          {#if pickerLoading}
            <span class="text-xs opacity-30">…</span>
          {:else if pickerQuery}
            <button
              class="cursor-pointer opacity-30 hover:opacity-80"
              onclick={() => {
                pickerQuery = '';
                pickerResults = [];
                pickerError = false;
              }}
            >
              <X size={12} />
            </button>
          {/if}
        </div>

        {#if pickerLoading}
          <div
            class="mt-3 overflow-hidden py-6"
            in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
            out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
          >
            <Loader />
          </div>
        {:else if pickerError}
          <p
            class="mt-3 overflow-hidden text-xs opacity-40"
            in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
            out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
          >
            No results found.
          </p>
        {:else if pickerResults.length}
          <ul
            class="mt-3 flex flex-col gap-0 overflow-hidden border border-fg/10"
            in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
            out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
          >
            {#each pickerResults as result (result.id)}
              <li class="border-b border-fg/10 last:border-b-0">
                <button
                  class="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-fg/5"
                  onclick={() => selectFromPicker(result)}
                >
                  {#if result.coverUrl}
                    <img
                      src={result.coverUrl}
                      alt={result.title}
                      class="h-12 w-9 shrink-0 object-cover opacity-80"
                    />
                  {:else}
                    <div
                      class="flex h-12 w-9 shrink-0 items-center justify-center border border-fg/10"
                    >
                      <BookOpen size={14} class="opacity-20" />
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-bold">{result.title}</p>
                    <div class="mt-0.5 flex items-center gap-2 text-xs opacity-40">
                      {#if result.year}<span>{result.year}</span>{/if}
                      {#if result.status}<span>{result.status.toUpperCase()}</span>{/if}
                      {#if result.authors.length}<span class="truncate">{result.authors[0]}</span
                        >{/if}
                    </div>
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <div bind:this={chapterSentinelEl}></div>

    <!-- Sticky chapters header -->
    <div
      class="sticky z-10 mt-8 bg-bg pb-3 {chapterHeaderStuck ? '' : 'border-t border-fg/10'}"
      style="top: var(--safe-top, 0px); padding-top: {chapterHeaderStuck ? '0.75rem' : '2rem'};"
    >
      <div class="flex items-center gap-4">
        <span class="shrink-0 text-xs font-bold tracking-widest opacity-30">
          CHAPTERS ({chapters.length})
        </span>
        <div class="flex min-w-0 flex-1 items-center gap-2 border border-fg/15 px-3 py-1.5">
          <Search size={12} class="shrink-0 opacity-30" />
          <input
            bind:value={search}
            placeholder="Search chapters…"
            class="flex-1 bg-transparent text-sm outline-none placeholder:opacity-30"
          />
          {#if search}
            <button
              class="cursor-pointer opacity-30 hover:opacity-80"
              onclick={() => (search = '')}
            >
              <X size={12} />
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Virtual chapter list -->
    {#if filteredChapters.length === 0}
      <p
        class="py-8 text-center text-xs opacity-30"
        in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
      >
        No chapters match "{search}"
      </p>
    {:else}
      <div bind:this={listEl} style="height: {mobileTotalSize}px; position: relative;">
        {#each mobileVirtualItems as row (row.key)}
          {@const chapter = filteredChapters[row.index]}
          {@const isResume = savedProgress?.chapter === chapter.name}
          <button
            style="position: absolute; top: {row.start -
              scrollMargin}px; left: 0; right: 0; height: {ROW_H}px;"
            class="flex w-full cursor-pointer items-center justify-between border-b border-fg/10 px-2 text-left hover:bg-fg/5"
            onclick={() => readChapter(chapter.name)}
          >
            <span class="truncate text-sm {isResume ? 'font-bold' : 'opacity-70'}"
              >{chapter.name}</span
            >
            <div class="ml-4 flex shrink-0 items-center gap-3">
              {#if isResume}
                <span class="text-xs opacity-40">p.{savedProgress.page + 1}</span>
              {/if}
              <span class="text-xs opacity-30">{chapter.pageCount}p</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
