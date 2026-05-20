<script lang="ts">
  import { ArrowLeft, Search, X, BookOpen } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import { searchManga } from '$lib/api/mangadex';
  import type { MangaMeta } from '$lib/api/mangadex';

  const svc = getReaderContext();
  const { state: manga } = svc;

  const mangaName = $derived(svc.provider?.mangaName ?? '');
  const chapters = $derived(svc.chapters);
  const savedProgress = $derived(svc.getSavedProgress());

  let meta: MangaMeta | null = $state(null);
  let metaError = $state(false);
  let search = $state('');

  const filteredChapters = $derived(
    search.trim()
      ? chapters.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
      : chapters
  );

  $effect(() => {
    if (!mangaName) return;
    meta = null;
    metaError = false;
    searchManga(mangaName)
      .then((result) => {
        meta = result;
        if (!result) metaError = true;
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
  <button
    class="mb-6 flex cursor-pointer items-center gap-1.5 text-xs tracking-widest opacity-30 hover:opacity-80"
    onclick={svc.clearManga}
  >
    <ArrowLeft size={12} />
    LIBRARY
  </button>

  <!-- Cover + info side by side -->
  <div class="flex flex-col gap-6 sm:flex-row">
    <!-- Cover -->
    <div class="relative h-56 w-40 shrink-0 self-center border-2 border-white/10 sm:self-auto">
      {#if meta?.coverUrl}
        <img
          src={meta.coverUrl}
          alt={meta?.title ?? mangaName}
          class="absolute inset-0 h-full w-full object-cover"
        />
      {:else}
        <div class="flex h-full w-full items-center justify-center">
          <BookOpen size={32} class="opacity-10" />
        </div>
      {/if}
    </div>

    <!-- Info -->
    <div class="flex min-w-0 flex-1 flex-col">
      <h1 class="text-xl leading-tight font-bold">
        {meta?.title || mangaName}
      </h1>
      {#if meta?.title && meta.title !== mangaName}
        <p class="mt-0.5 text-xs opacity-30">{mangaName}</p>
      {/if}

      <div class="mt-3 flex min-h-[5rem] flex-col gap-3">
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
            <span class="text-xs opacity-40">{meta.authors.join(', ')}</span>
          {/if}
        </div>

        {#if meta.tags.length}
          <div class="flex flex-wrap gap-1.5">
            {#each meta.tags.slice(0, 12) as tag}
              <span class="border border-white/15 px-2 py-0.5 text-xs opacity-50">{tag}</span>
            {/each}
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
      {:else if !metaError}
        <div class="flex gap-3">
          <div class="h-5 w-20 animate-pulse bg-white/10"></div>
          <div class="h-5 w-10 animate-pulse bg-white/10"></div>
          <div class="h-5 w-32 animate-pulse bg-white/10"></div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each [60, 44, 72, 56, 48] as w}
            <div class="h-5 animate-pulse bg-white/10" style="width: {w}px"></div>
          {/each}
        </div>
      {/if}
    </div>

    {#if savedProgress}
      <div class="mt-6">
        <button
          class="cursor-pointer border-1 border-white px-4 py-2 text-sm hover:bg-white hover:text-black"
          onclick={resume}
        >
          RESUME: {savedProgress.chapter}, p.{savedProgress.page + 1}
        </button>
      </div>
    {/if}
    </div>
  </div>

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
                {isResume ? 'text-white' : 'hover:bg-white/5'}"
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
