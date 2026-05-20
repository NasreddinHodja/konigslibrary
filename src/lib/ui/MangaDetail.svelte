<script lang="ts">
  import { ArrowLeft, Search, X, BookOpen } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
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
    manga.selectedChapter = name;
    manga.currentPage = 0;
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
          class="cursor-pointer self-start border-1 border-white px-4 py-2 text-sm hover:bg-white hover:text-black"
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

        <div class="mt-3 flex min-h-[7rem] flex-col gap-3 sm:min-h-0 sm:flex-1 sm:overflow-hidden">
          {#if meta}
            <div class="flex flex-wrap items-center gap-3">
              {#if meta.status}
                <span
                  class="border px-2 py-0.5 text-xs font-bold tracking-widest
                  {meta.status === 'ongoing'
                    ? 'border-green-500/50 text-green-400'
                    : 'border-white/20 opacity-50'}"
                >
                  {STATUS_LABEL[meta.status] ?? meta.status.toUpperCase()}
                </span>
              {/if}
              {#if meta.year}
                <span class="text-xs opacity-40">{meta.year}</span>
              {/if}
              {#if meta.authors.length}
                <span class="hidden text-xs opacity-40 sm:inline">{meta.authors.join(', ')}</span>
              {/if}
            </div>

            {#if meta.authors.length}
              <div class="flex items-center gap-1.5 sm:hidden">
                <span
                  bind:this={authorsEl}
                  class="min-w-0 text-xs opacity-40 {authorsExpanded ? '' : 'truncate'}"
                  >{meta.authors.join(', ')}</span
                >
                {#if authorsExpanded || authorsTruncated}
                  <button
                    class="shrink-0 cursor-pointer text-xs opacity-30 hover:opacity-70"
                    onclick={() => (authorsExpanded = !authorsExpanded)}
                    >{authorsExpanded ? 'less' : 'more'}</button
                  >
                {/if}
              </div>
            {/if}

            {#if meta.tags.length}
              <div class="flex flex-wrap gap-1.5">
                {#each tagsExpanded ? meta.tags.slice(0, 6) : meta.tags.slice(0, TAGS_COLLAPSED) as tag}
                  <span class="border border-white/15 px-2 py-0.5 text-xs opacity-50">{tag}</span>
                {/each}
                {#if meta.tags.length > TAGS_COLLAPSED}
                  <button
                    class="cursor-pointer text-xs opacity-30 hover:opacity-70"
                    onclick={() => (tagsExpanded = !tagsExpanded)}
                    >{tagsExpanded ? 'less' : 'more'}</button
                  >
                {/if}
              </div>
            {/if}

            {#if meta.status === 'ongoing' && meta.latestChapter}
              <div class="self-start border border-white/10 px-3 py-2 text-xs">
                <span class="opacity-40">Latest on MangaDex: </span>
                <span class="">Ch. {meta.latestChapter}</span>
                {#if meta.latestChapterDate}
                  <span class="opacity-30"> · {formatDate(meta.latestChapterDate)}</span>
                {/if}
              </div>
            {/if}
          {:else}
            <div class="flex flex-wrap items-center gap-3">
              <Skeleton class="h-[22px] w-20" />
              <Skeleton class="h-[22px] w-8" />
              <Skeleton class="hidden h-[22px] w-32 sm:block" />
            </div>
            <Skeleton class="h-4 w-40 sm:hidden" />
            <div class="flex flex-wrap gap-1.5">
              {#each [60, 52, 56, 48] as w}
                <Skeleton class="h-[22px]" style="width: {w}px" />
              {/each}
            </div>
          {/if}
        </div>

        <!-- Bottom actions: resume + not this manga, pinned to bottom -->
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mt-auto sm:pt-3">
          {#if savedProgress}
            <button
              class="cursor-pointer border-1 border-white px-4 py-2 text-sm hover:bg-white hover:text-black"
              onclick={resume}
            >
              RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
            </button>
          {/if}
          {#if !pickerOpen}
            <button
              class="cursor-pointer text-xs underline opacity-30 hover:opacity-70
                {meta ? '' : 'pointer-events-none invisible'}"
              onclick={openPicker}
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
    <div class="mt-4 border border-white/15 p-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-xs font-bold tracking-widest opacity-50">SEARCH ANILIST</span>
        <button
          class="cursor-pointer opacity-30 hover:opacity-80"
          onclick={() => (pickerOpen = false)}
        >
          <X size={12} />
        </button>
      </div>
      <div class="flex items-center gap-2 border border-white/15 px-3 py-1.5">
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
        <ul class="mt-3 flex flex-col gap-0 border border-white/10">
          {#each { length: 4 } as _}
            <li class="border-b border-white/10 last:border-b-0">
              <div class="flex items-center gap-3 px-3 py-2.5">
                <Skeleton class="h-12 w-9 shrink-0" />
                <div class="min-w-0 flex-1">
                  <Skeleton class="h-[14px] w-3/4" />
                  <div class="mt-1.5 flex gap-2">
                    <Skeleton class="h-[11px] w-8" />
                    <Skeleton class="h-[11px] w-14" />
                    <Skeleton class="h-[11px] w-20" />
                  </div>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {:else if pickerError}
        <p class="mt-3 text-xs opacity-40">No results found.</p>
      {:else if pickerResults.length}
        <ul class="mt-3 flex flex-col gap-0 border border-white/10">
          {#each pickerResults as result}
            <li class="border-b border-white/10 last:border-b-0">
              <button
                class="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5"
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
                    class="flex h-12 w-9 shrink-0 items-center justify-center border border-white/10"
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

  <!-- Divider -->
  <div class="mt-6 border-t border-white/10"></div>

  <!-- Chapter list -->
  <div class="mt-4">
    <div class="mb-4 flex items-center gap-4">
      <span class="shrink-0 text-xs font-bold tracking-widest opacity-30">
        CHAPTERS ({chapters.length})
      </span>
      <div class="flex flex-1 items-center gap-2 border border-white/15 px-3 py-1.5">
        <Search size={12} class="shrink-0 opacity-30" />
        <input
          bind:value={search}
          placeholder="Search chapters…"
          class="flex-1 bg-transparent text-sm outline-none placeholder:opacity-30"
        />
        {#if search}
          <button class="cursor-pointer opacity-30 hover:opacity-80" onclick={() => (search = '')}>
            <X size={12} />
          </button>
        {/if}
      </div>
    </div>

    {#if filteredChapters.length === 0}
      <p class="py-8 text-center text-xs opacity-30">No chapters match "{search}"</p>
    {:else}
      <ul>
        {#each filteredChapters as chapter (chapter.name)}
          {@const isResume = savedProgress?.chapter === chapter.name}
          <li class="border-b border-white/10 last:border-b-0">
            <button
              class="flex w-full cursor-pointer items-center justify-between px-2 py-3 text-left
                {isResume ? 'text-white hover:bg-white/5' : 'hover:bg-white/5'}"
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
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
