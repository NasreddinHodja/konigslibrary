<script lang="ts">
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
  import { BookOpen, Download } from 'lucide-svelte';
  import ListPanel from '$lib/ui/ListPanel.svelte';
  import { TILE, TILE_DESKTOP_QUERY } from '$lib/ui/tile-grid';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import Button from '$lib/ui/Button.svelte';
  import PageContainer from '$lib/ui/PageContainer.svelte';
  import BackLink from '$lib/ui/BackLink.svelte';
  import { getReaderContext } from '$lib/context';
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

  const meta = $derived(reader.meta);
  const metaError = $derived(reader.metaState === 'missing');
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
    const mq = window.matchMedia(TILE_DESKTOP_QUERY);
    isDesktop = mq.matches;
    const handler = (e: MediaQueryListEvent) => (isDesktop = e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  const TAGS_COLLAPSED = 4;

  $effect(() => {
    void mangaName;
    coverFailed = false;
    tagsExpanded = false;
  });

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
    saveManga(serverSource.slug, reader.title, serverSource.getServerChapters(), reader.events);
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
          STATUS
        </div>
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          {#if meta.status}
            <span
              class="border px-2 py-0.5 text-xs font-bold tracking-widest uppercase {meta.status.toLowerCase() ===
              'ongoing'
                ? 'border-success/50 text-success'
                : 'border-border/20 opacity-50'}"
            >
              {meta.status}
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
    <VirtualGrid
      items={filteredChapters}
      minItemWidth={isDesktop ? TILE.desktop.min : TILE.phone.min}
      gap={isDesktop ? TILE.desktop.gap : TILE.phone.gap}
      key={(c) => c.name}
    >
      {#snippet item(chapter)}
        {@render chapterTile(chapter)}
      {/snippet}
    </VirtualGrid>
  {/if}
{/snippet}

{#snippet cover(sizeClass: string)}
  <div class="relative shrink-0 border-2 border-border/15 {sizeClass}">
    {#if meta?.coverUrl && !coverFailed}
      <img
        src={meta.coverUrl}
        alt={meta?.title ?? mangaName}
        class="absolute inset-0 h-full w-full object-cover"
        onerror={() => (coverFailed = true)}
      />
    {:else if reader.metaState === 'loading'}
      <Skeleton class="absolute inset-0" />
    {:else}
      <div class="flex h-full w-full items-center justify-center bg-fg/[0.03]">
        <BookOpen size={22} class="opacity-20" />
      </div>
    {/if}
  </div>
{/snippet}

<!-- One page scroll for both layouts: the metadata scrolls away and the
     chapters' bar pins below the status bar, like the library's. -->
<div
  class="flex min-h-dvh w-full flex-col {showShell
    ? 'pb-[calc(5.25rem_+_var(--safe-bottom))] md:pb-8'
    : 'pb-[calc(2rem_+_var(--safe-bottom))]'}"
  style="padding-top: var(--safe-top)"
>
  <PageContainer maxWidth="max-w-4xl">
    <div class="flex flex-col gap-6 pt-8">
      <BackLink label="LIBRARY" onclick={reader.clearManga} />

      {#if metaError && !meta}
        <div class="flex flex-col gap-4">
          <h1 class="text-xl leading-tight font-bold">{mangaName}</h1>
          {#if savedProgress}
            <Button size="lg" variant="default" class="self-start" onclick={resume}>
              RESUME: {chapterLabel(savedProgress.chapter)}, p.{savedProgress.page + 1}
            </Button>
          {/if}
        </div>
      {:else if isDesktop}
        <div class="flex items-start gap-6">
          {@render cover('h-56 w-40')}
          <div class="min-w-0 flex-1">
            {@render specTable()}
          </div>
        </div>

        {#if savedProgress || canDownload}
          <div class="flex items-center justify-end gap-3">
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
      {:else}
        <div class="mx-auto">
          {@render cover('h-64 w-44')}
        </div>

        {@render specTable()}

        {#if savedProgress || canDownload}
          <div class="flex flex-wrap justify-end gap-3">
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
    </div>
  </PageContainer>

  <!-- Same width as the metadata above; ListPanel's own px-4 makes up the
       rest of PageContainer's md:px-8, so the edges line up. -->
  <div class="mx-auto mt-6 flex w-full max-w-4xl flex-1 flex-col md:px-4">
    <ListPanel label="CHAPTERS ({chapters.length})" bind:search placeholder="Search chapters…">
      {@render chapterGrid()}
    </ListPanel>
  </div>
</div>

{#if confirmingDownload}
  <ConfirmDialog
    message={`Download "${reader.title}"? This may take a while depending on size.`}
    confirmLabel="Download"
    onconfirm={download}
    oncancel={() => (confirmingDownload = false)}
  />
{/if}
