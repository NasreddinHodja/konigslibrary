<script lang="ts">
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
  import { Download, Search, X } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import Button from '$lib/ui/Button.svelte';
  import PageContainer from '$lib/ui/PageContainer.svelte';
  import BackLink from '$lib/ui/BackLink.svelte';
  import { getReaderContext } from '$lib/context';
  import type { MangaMeta } from '$lib/api/meta';
  import { isNative } from '$lib/utils/platform';
  import { chapterLabel, chapterNumber } from '$lib/utils/chapters';
  import { isLocalServer } from '$lib/utils/constants';
  import { invoke } from '@tauri-apps/api/core';
  import { ServerLibraryProvider } from '$lib/sources';
  import { saveManga } from '$lib/sources/download.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import ChapterTile from '$lib/chapters/ChapterTile.svelte';
  import VirtualGrid from '$lib/ui/virtual/VirtualGrid.svelte';

  const reader = getReaderContext();
  const { state: manga } = reader;

  const showShell = isNative() || isLocalServer;

  const mangaName = $derived(reader.provider?.mangaName ?? '');
  const chapters = $derived(reader.chapters);
  const savedProgress = $derived(reader.getSavedProgress());

  let meta: MangaMeta | null = $state(null);
  let metaError = $state(false);
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

  const filteredChapters = $derived(
    search.trim()
      ? chapters.filter((c) =>
          [c.name, chapterNumber(c.name) ?? ''].some((s) =>
            s.toLowerCase().includes(search.trim().toLowerCase())
          )
        )
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
    coverFailed = false;
    tagsExpanded = false;
    loadMeta();
  });

  async function loadMeta() {
    const result = (await reader.provider?.loadMeta?.()) ?? null;
    if (result) meta = result;
    else metaError = true;
  }

  // A server manga with no copy on this device can be downloaded from here.
  const serverSource = $derived(
    isNative() && reader.provider instanceof ServerLibraryProvider ? reader.provider : null
  );
  let downloaded = $state(true);
  let confirmingDownload = $state(false);
  const canDownload = $derived(!!serverSource && !downloaded);

  $effect(() => {
    const source = serverSource;
    if (!source) return;
    downloaded = true;
    const check = () =>
      invoke<{ slug: string }[]>('list_offline_manga')
        .then((list) => (downloaded = list.some((m) => m.slug === source.slug)))
        .catch(() => {});
    check();
    const offComplete = reader.events.on('download:complete', check);
    const offError = reader.events.on('download:error', check);
    return () => {
      offComplete();
      offError();
    };
  });

  function download() {
    confirmingDownload = false;
    if (!serverSource) return;
    // Hidden while it runs; the toast shows progress.
    downloaded = true;
    saveManga(serverSource.slug, mangaName, serverSource.getServerChapters(), reader.events);
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
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
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
    {:else}
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
  <ChapterTile
    name={chapter.name}
    number={chapterNumber(chapter.name) ?? String((chapterIndex.get(chapter.name) ?? 0) + 1)}
    title="{chapterLabel(chapter.name)} — {chapter.pageCount} pages{isResume
      ? ` — resume at p.${savedProgress.page + 1}`
      : ''}"
    pageCount={chapter.pageCount}
    highlighted={isResume}
    onclick={() => readChapter(chapter.name)}
  />
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
    <div class="p-4">
      <VirtualGrid
        items={filteredChapters}
        minItemWidth={isDesktop ? 80 : 88}
        gap={isDesktop ? 8 : 10}
        key={(c) => c.name}
      >
        {#snippet item(chapter)}
          {@render chapterTile(chapter)}
        {/snippet}
      </VirtualGrid>
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
        {#if savedProgress}
          <Button size="lg" variant="default" class="self-start" onclick={resume}>
            RESUME: {chapterLabel(savedProgress.chapter)}, p.{savedProgress.page + 1}
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

      {#if savedProgress || canDownload}
        <!-- Actions -->
        <div class="flex shrink-0 items-center justify-end gap-3">
          {#if canDownload}
            <Button
              size="md"
              variant="default"
              class="border-fg/40"
              onclick={() => (confirmingDownload = true)}
            >
              <Download size={14} />
              DOWNLOAD
            </Button>
          {/if}
          {#if savedProgress}
            <Button size="md" variant="default" onclick={resume}>
              RESUME: {chapterLabel(savedProgress.chapter)}, p.{savedProgress.page + 1}
            </Button>
          {/if}
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
              RESUME: {chapterLabel(savedProgress.chapter)}, p.{savedProgress.page + 1}
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

        {#if savedProgress || canDownload}
          <!-- Actions -->
          <div class="mt-4 flex flex-col gap-3">
            {#if savedProgress}
              <Button size="md" variant="default" class="w-full" onclick={resume}>
                RESUME: {chapterLabel(savedProgress.chapter)}, p.{savedProgress.page + 1}
              </Button>
            {/if}
            {#if canDownload}
              <Button
                size="md"
                variant="default"
                class="w-full border-fg/40"
                onclick={() => (confirmingDownload = true)}
              >
                <Download size={14} />
                DOWNLOAD
              </Button>
            {/if}
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

{#if confirmingDownload}
  <ConfirmDialog
    message={`Download "${mangaName}"? This may take a while depending on size.`}
    confirmLabel="Download"
    onconfirm={download}
    oncancel={() => (confirmingDownload = false)}
  />
{/if}
