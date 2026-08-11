<script lang="ts">
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import { Search, X } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import Loader from '$lib/ui/Loader.svelte';
  import Button from '$lib/ui/Button.svelte';
  import PageContainer from '$lib/ui/PageContainer.svelte';
  import BackLink from '$lib/ui/BackLink.svelte';
  import { getReaderContext } from '$lib/context';
  import { searchManga, searchMangaMultiple, RateLimitError } from '$lib/api/anilist';
  import type { MangaMeta } from '$lib/api/anilist';
  import { fetchLatestChapter } from '$lib/api/mangadex';
  import { isNative } from '$lib/utils/platform';
  import { isLocalServer } from '$lib/utils/constants';

  const reader = getReaderContext();
  const { state: manga } = reader;

  const showShell = isNative() || isLocalServer;

  const mangaName = $derived(reader.provider?.mangaName ?? '');
  const chapters = $derived(reader.chapters);
  const savedProgress = $derived(reader.getSavedProgress());

  let meta: MangaMeta | null = $state(null);
  let metaError = $state(false);
  let metaRateLimited = $state(false);
  let coverFailed = $state(false);
  let search = $state('');

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

  const chapterIndex = $derived(new Map(chapters.map((c, i) => [c.name, i])));

  let isDesktop = $state(false);

  $effect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    isDesktop = mq.matches;
    const handler = (e: MediaQueryListEvent) => (isDesktop = e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  const TAGS_COLLAPSED = 4;

  $effect(() => {
    if (!mangaName) return;
    meta = null;
    metaError = false;
    metaRateLimited = false;
    coverFailed = false;
    tagsExpanded = false;
    loadMeta(mangaName);
  });

  async function loadMeta(name: string) {
    try {
      const result = await searchManga(name);
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
    } catch (err) {
      if (err instanceof RateLimitError) {
        metaRateLimited = true;
      }
      metaError = true;
    }
  }

  function retryMeta() {
    metaError = false;
    metaRateLimited = false;
    loadMeta(mangaName);
  }

  function resume() {
    if (!savedProgress) return;
    manga.selectedChapter = savedProgress.chapter;
    manga.currentPage = savedProgress.page;
    manga.shouldScroll = true;
  }

  function readChapter(name: string) {
    const progress = reader.getSavedProgress();
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

{#snippet tagsValue()}
  {#if meta && meta.tags.length}
    {#each meta.tags.slice(0, TAGS_COLLAPSED) as tag (tag)}
      <span class="border border-border/30 px-2 py-0.5 text-xs opacity-50">{tag}</span>
    {/each}
    {#if tagsExpanded}
      {#each meta.tags.slice(TAGS_COLLAPSED, 6) as tag (tag)}
        <span class="border border-border/30 px-2 py-0.5 text-xs opacity-50">{tag}</span>
      {/each}
      <button
        class="cursor-pointer border border-border/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
        onclick={collapseTags}>less</button
      >
    {:else if meta.tags.length > TAGS_COLLAPSED}
      <button
        class="cursor-pointer border border-border/15 px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
        onclick={expandTags}>more</button
      >
    {/if}
  {:else}
    <span class="opacity-40">—</span>
  {/if}
{/snippet}

{#snippet specTable()}
  <div class="w-full divide-y divide-border/10 border-2 border-border/15">
    <div class="flex">
      <div
        class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
      >
        TITLE
      </div>
      <div
        class="flex min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      >
        <span class="min-w-0 text-sm font-bold sm:truncate">{meta?.title || mangaName}</span>
        <button
          class="shrink-0 cursor-pointer text-xs underline opacity-50 hover:opacity-80 disabled:pointer-events-none disabled:opacity-0"
          disabled={!meta}
          onclick={() => (pickerOpen ? (pickerOpen = false) : openPicker())}
        >
          Not this manga?
        </button>
      </div>
    </div>
    <div class="flex">
      <div
        class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
      >
        FILENAME
      </div>
      <div class="min-w-0 flex-1 truncate px-3 py-2.5 text-sm opacity-50">{mangaName}</div>
    </div>
    {#if meta}
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          STATUS
        </div>
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          {#if meta.status}
            <span
              class="border px-2 py-0.5 text-xs font-bold tracking-widest
              {meta.status === 'ongoing'
                ? 'border-success/50 text-success'
                : 'border-border/20 opacity-50'}"
            >
              {STATUS_LABEL[meta.status] ?? meta.status.toUpperCase()}
            </span>
          {:else}
            <span class="text-sm opacity-40">—</span>
          {/if}
        </div>
      </div>
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          AUTHOR
        </div>
        <div class="min-w-0 flex-1 px-3 py-2.5 text-sm">{meta.authors.join(', ') || '—'}</div>
      </div>
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          YEAR
        </div>
        <div class="min-w-0 flex-1 px-3 py-2.5 text-sm">{meta.year ?? '—'}</div>
      </div>
      <div
        class="flex {meta.status === 'ongoing' && meta.latestChapter
          ? 'border-b border-border/10'
          : ''}"
        in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
      >
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          TAGS
        </div>
        <div
          class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-3 py-2.5"
          bind:this={tagsEl}
        >
          {@render tagsValue()}
        </div>
      </div>
      {#if meta.status === 'ongoing' && meta.latestChapter}
        <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
          <div
            class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
          >
            LATEST
          </div>
          <div class="min-w-0 flex-1 px-3 py-2.5 text-sm">
            Ch. {meta.latestChapter}
            {#if meta.latestChapterDate}
              <span class="opacity-50"> · {formatDate(meta.latestChapterDate)}</span>
            {/if}
            <span class="opacity-40"> (MangaDex)</span>
          </div>
        </div>
      {/if}
    {:else}
      <div class="flex">
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          STATUS
        </div>
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          <Skeleton class="h-[18px] w-20" />
        </div>
      </div>
      <div class="flex">
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          AUTHOR
        </div>
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          <Skeleton class="h-4 w-32" />
        </div>
      </div>
      <div class="flex">
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          YEAR
        </div>
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          <Skeleton class="h-4 w-10" />
        </div>
      </div>
      <div class="flex">
        <div
          class="w-24 shrink-0 border-r border-border/10 px-3 py-2.5 text-[0.65rem] font-bold tracking-widest opacity-45 sm:w-28"
        >
          TAGS
        </div>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-3 py-2.5">
          {#each [60, 52, 56, 48] as w (w)}
            <Skeleton class="h-[18px]" style="width: {w}px" />
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet chaptersHeadRow(stacked: boolean)}
  <div
    class="flex shrink-0 gap-3 border-b border-border/15 px-4 py-3 {stacked
      ? 'flex-col'
      : 'items-center gap-4'}"
  >
    <span class="shrink-0 text-xs font-bold tracking-widest opacity-50">
      CHAPTERS ({chapters.length})
    </span>
    <div
      class="flex min-w-0 items-center gap-2 border-2 border-border/15 px-3 py-1.5 {stacked
        ? 'w-full'
        : 'flex-1'}"
    >
      <Search size={12} class="shrink-0 opacity-50" />
      <input
        bind:value={search}
        placeholder="Search chapters…"
        class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
      />
      {#if search}
        <button class="cursor-pointer opacity-50 hover:opacity-80" onclick={() => (search = '')}>
          <X size={12} />
        </button>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet chapterTile(chapter: (typeof filteredChapters)[number])}
  {@const isResume = savedProgress?.chapter === chapter.name}
  {@const trueIndex = chapterIndex.get(chapter.name) ?? 0}
  <button
    class="flex aspect-square cursor-pointer flex-col items-center justify-center gap-0.5 border-2 text-center
      {isResume ? 'border-fg bg-fg/5' : 'border-border/12 hover:border-border/40'}"
    title="Chapter {trueIndex + 1} — {chapter.pageCount} pages{isResume
      ? ` — resume at p.${savedProgress.page + 1}`
      : ''}"
    onclick={() => readChapter(chapter.name)}
  >
    <span class="text-base font-bold tabular-nums md:text-sm {isResume ? '' : 'opacity-80'}"
      >{trueIndex + 1}</span
    >
    <span class="text-xs tabular-nums opacity-45 md:text-[0.6rem]">{chapter.pageCount}p</span>
  </button>
{/snippet}

{#snippet chapterGrid()}
  {#if filteredChapters.length === 0}
    <p
      class="py-8 text-center text-xs opacity-50"
      in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
    >
      No chapters match "{search}"
    </p>
  {:else}
    <div
      class="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2.5 p-4 md:grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] md:gap-2"
    >
      {#each filteredChapters as chapter (chapter.name)}
        {@render chapterTile(chapter)}
      {/each}
    </div>
  {/if}
{/snippet}

{#if isDesktop}
  <!-- Desktop: single scroll column, bordered panels -->
  <div
    class="mx-auto flex max-w-4xl flex-col gap-6 overflow-hidden"
    style="height: 100dvh; padding: calc(2rem + var(--safe-top)) 2rem max(2rem, var(--safe-bottom))"
  >
    <!-- Back -->
    <div class="shrink-0">
      <BackLink label="LIBRARY" onclick={reader.clearManga} />
    </div>

    {#if metaError && !meta}
      <div class="flex shrink-0 flex-col gap-4">
        <h1 class="text-xl leading-tight font-bold">{mangaName}</h1>
        {#if metaRateLimited}
          <p class="text-xs opacity-60">AniList is rate-limiting requests.</p>
          <button
            class="cursor-pointer self-start text-xs underline opacity-50 hover:opacity-70"
            onclick={retryMeta}
          >
            Retry
          </button>
        {/if}
        {#if savedProgress}
          <Button size="lg" variant="default" class="self-start" onclick={resume}>
            RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
          </Button>
        {/if}
      </div>
    {:else}
      <!-- Cover + spec table -->
      <div class="flex shrink-0 items-center gap-6">
        <div class="relative h-56 w-40 shrink-0 border-2 border-border/15">
          {#if meta?.coverUrl && !coverFailed}
            <img
              src={meta.coverUrl}
              alt={meta?.title ?? mangaName}
              class="absolute inset-0 h-full w-full object-cover"
              onerror={() => (coverFailed = true)}
            />
          {:else}
            <Skeleton class="absolute inset-0" />
          {/if}
        </div>

        <div class="min-w-0 flex-1">
          {@render specTable()}
        </div>
      </div>

      {#if savedProgress}
        <!-- Actions -->
        <div class="flex shrink-0 items-center justify-end">
          <Button size="md" variant="default" onclick={resume}>
            RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
          </Button>
        </div>
      {/if}
    {/if}

    <!-- Chapters panel -->
    <div class="flex min-h-0 flex-1 flex-col border-2 border-border/15">
      {@render chaptersHeadRow(false)}

      <div class="min-h-0 flex-1 overflow-y-auto">
        {@render chapterGrid()}
      </div>
    </div>
  </div>
{:else}
  <!-- Mobile: stacked single column, whole page scrolls -->
  <PageContainer maxWidth="max-w-4xl">
    <div
      class="flex min-h-screen w-full flex-col {showShell
        ? 'pb-[calc(5.25rem_+_var(--safe-bottom))]'
        : 'pb-[calc(2rem_+_var(--safe-bottom))]'}"
      style="padding-top: calc(2rem + var(--safe-top))"
    >
      <!-- Back -->
      <div class="mb-6 flex items-center justify-between">
        <BackLink label="LIBRARY" onclick={reader.clearManga} />
      </div>

      {#if metaError && !meta}
        <div class="flex flex-col gap-4">
          <h1 class="text-xl leading-tight font-bold">{mangaName}</h1>
          {#if savedProgress}
            <Button size="lg" variant="default" class="self-start" onclick={resume}>
              RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
            </Button>
          {/if}
        </div>
      {:else}
        <!-- Cover -->
        <div class="relative mx-auto h-64 w-44 shrink-0 border-2 border-border/15">
          {#if meta?.coverUrl && !coverFailed}
            <img
              src={meta.coverUrl}
              alt={meta?.title ?? mangaName}
              class="absolute inset-0 h-full w-full object-cover"
              onerror={() => (coverFailed = true)}
            />
          {:else}
            <Skeleton class="absolute inset-0" />
          {/if}
        </div>

        <!-- Spec table -->
        <div class="mt-6">
          {@render specTable()}
        </div>

        {#if savedProgress}
          <!-- Actions -->
          <div class="mt-4">
            <Button size="md" variant="default" class="w-full" onclick={resume}>
              RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
            </Button>
          </div>
        {/if}
      {/if}

      <!-- Chapters panel -->
      <div class="mt-3 border-2 border-border/15">
        {@render chaptersHeadRow(true)}
        {@render chapterGrid()}
      </div>
    </div></PageContainer
  >
{/if}

{#if pickerOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center px-4"
    out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
  >
    <button
      class="absolute inset-0 bg-surface/50 backdrop-blur-xl"
      onclick={() => (pickerOpen = false)}
      aria-label="Close"
    ></button>
    <div
      class="relative z-10 flex h-[420px] w-full max-w-sm flex-col border-2 border-border/35 bg-bg p-4"
      in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
    >
      <div class="mb-3 flex items-center justify-between">
        <span class="text-xs font-bold tracking-widest opacity-50">SEARCH ANILIST</span>
        <button
          class="cursor-pointer opacity-50 hover:opacity-80"
          onclick={() => (pickerOpen = false)}
        >
          <X size={12} />
        </button>
      </div>
      <div class="flex items-center gap-2 border-2 border-border/15 px-3 py-1.5">
        <Search size={12} class="shrink-0 opacity-50" />
        <input
          bind:value={pickerQuery}
          placeholder="Search title…"
          class="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
        />
        {#if pickerLoading}
          <span class="text-xs opacity-50">…</span>
        {:else if pickerQuery}
          <button
            class="cursor-pointer opacity-50 hover:opacity-80"
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
      <div class="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
        {#if pickerLoading}
          <div class="flex flex-1 items-center justify-center">
            <Loader />
          </div>
        {:else if pickerError}
          <p class="text-xs opacity-60">No results found.</p>
        {:else if pickerResults.length}
          <ul class="flex max-h-full flex-col gap-0 overflow-y-auto border border-border/10">
            {#each pickerResults as result (result.id)}
              <li class="border-b border-border/10 last:border-b-0">
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
                      class="flex h-12 w-9 shrink-0 items-center justify-center border border-border/10"
                    >
                      <span class="text-base opacity-20">∅</span>
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-bold">{result.title}</p>
                    <div class="mt-0.5 flex items-center gap-2 text-xs opacity-60">
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
        {:else}
          <div class="flex flex-1 items-center justify-center">
            <span class="text-4xl opacity-10">∅</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
