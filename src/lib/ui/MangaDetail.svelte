<script lang="ts">
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
  import { ArrowDown01, ArrowDown10, BookOpen, Download } from 'lucide-svelte';
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
  import { listOfflineManga } from '$lib/sources/native-library';
  import { ServerLibraryProvider } from '$lib/sources';
  import { saveManga } from '$lib/sources/download.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import ChapterTile from '$lib/chapters/ChapterTile.svelte';
  import VirtualGrid from '$lib/ui/virtual/VirtualGrid.svelte';
  import { authedSrc } from '$lib/api/authed-src.svelte';

  const reader = getReaderContext();
  const { state: manga } = reader;

  const showShell = isNative() || isLocalServer;

  const mangaName = $derived(reader.provider?.mangaName ?? '');
  const chapters = $derived(reader.chapters);
  const savedProgress = $derived(reader.getSavedProgress());

  const meta = $derived(reader.meta);
  const coverSrc = authedSrc(() => meta?.coverUrl ?? null);
  const metaError = $derived(reader.metaState === 'missing');
  // Both reset when another manga opens; writable so the page can set them.
  let coverFailed = $derived.by(() => {
    void mangaName;
    return false;
  });
  let search = $state('');

  let tagsExpanded = $derived.by(() => {
    void mangaName;
    return false;
  });
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

  const LS_CHAPTER_SORT = 'kl:chapterSort';
  // Newest first or oldest first, the same for every manga, kept across
  // launches.
  let descending = $state(localStorage.getItem(LS_CHAPTER_SORT) === 'desc');
  function toggleSort() {
    descending = !descending;
    localStorage.setItem(LS_CHAPTER_SORT, descending ? 'desc' : 'asc');
  }

  const filteredChapters = $derived.by(() => {
    const matching = search.trim()
      ? chapters.filter((c) =>
          [c.name, chapterNumber(c.name) ?? ''].some((s) =>
            s.toLowerCase().includes(search.trim().toLowerCase())
          )
        )
      : chapters;
    return descending ? [...matching].reverse() : matching;
  });

  const chapterIndex = $derived(new Map(chapters.map((c, i) => [c.name, i])));

  const desktop = new MediaQuery(TILE_DESKTOP_QUERY);
  const isDesktop = $derived(desktop.current);

  const TAGS_COLLAPSED = 4;
  const TAGS_EXPANDED = 6;

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
      listOfflineManga()
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
    {#each meta.tags.slice(0, tagsExpanded ? TAGS_EXPANDED : TAGS_COLLAPSED) as tag (tag)}
      <span class="border border-line-strong px-2 py-0.5 text-xs text-dim">{tag}</span>
    {/each}
    {#if tagsExpanded}
      <button
        class="hit relative cursor-pointer border border-line px-2 py-0.5 text-xs text-dim hover:text-fg"
        onclick={collapseTags}>less</button
      >
    {:else if meta.tags.length > TAGS_COLLAPSED}
      <button
        class="hit relative cursor-pointer border border-line px-2 py-0.5 text-xs text-dim hover:text-fg"
        onclick={expandTags}>more</button
      >
    {/if}
  {:else}
    <span class="text-faint">—</span>
  {/if}
{/snippet}

{#snippet actions(layout: string)}
  {#if savedProgress || canDownload}
    <div class="flex {layout} justify-end gap-3">
      {#if canDownload}
        <Button
          size="md"
          variant="default"
          class="border-line-strong"
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
{/snippet}

{#snippet specKey(label: string)}
  <div
    class="w-24 shrink-0 border-r border-line px-3 py-2.5 text-[11px] font-bold tracking-widest text-faint sm:w-28"
  >
    {label}
  </div>
{/snippet}

{#snippet filenameRow()}
  <div class="flex">
    {@render specKey('FILENAME')}
    <div class="min-w-0 flex-1 truncate px-3 py-2.5 text-sm text-dim">{mangaName}</div>
  </div>
{/snippet}

{#snippet specTable()}
  <div class="w-full divide-y divide-line border-2 border-line">
    {#if meta}
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        {@render specKey('STATUS')}
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          {#if meta.status}
            <span
              class="border px-2 py-0.5 text-xs font-bold tracking-widest uppercase {meta.status.toLowerCase() ===
              'ongoing'
                ? 'border-success/50 text-success'
                : 'border-line text-dim'}"
            >
              {meta.status}
            </span>
          {:else}
            <span class="text-sm text-faint">—</span>
          {/if}
        </div>
      </div>
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        {@render specKey('AUTHOR')}
        <div class="min-w-0 flex-1 px-3 py-2.5 text-sm">{meta.authors.join(', ') || '—'}</div>
      </div>
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        {@render specKey('YEAR')}
        <div class="min-w-0 flex-1 px-3 py-2.5 text-sm">{meta.year ?? '—'}</div>
      </div>
      {@render filenameRow()}
      <div class="flex" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        {@render specKey('TAGS')}
        <div
          class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-3 py-2.5"
          bind:this={tagsEl}
        >
          {@render tagsValue()}
        </div>
      </div>
    {:else}
      <div class="flex">
        {@render specKey('AUTHOR')}
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          <Skeleton class="h-4 w-32" />
        </div>
      </div>
      <div class="flex">
        {@render specKey('YEAR')}
        <div class="flex min-w-0 flex-1 items-center px-3 py-2.5">
          <Skeleton class="h-4 w-10" />
        </div>
      </div>
      {@render filenameRow()}
      <div class="flex">
        {@render specKey('TAGS')}
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
      class="py-8 text-center text-xs text-dim"
      in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
    >
      No chapters match "{search}"
    </p>
  {:else}
    <!-- Android scrolls ahead of the main thread, so rows added from a
         scroll handler can arrive late on a fling: tiles are kept five
         screens out, and the frames under them show past that. -->
    <VirtualGrid
      items={filteredChapters}
      minItemWidth={isDesktop ? TILE.desktop.min : TILE.phone.min}
      gap={isDesktop ? TILE.desktop.gap : TILE.phone.gap}
      overscan={5}
      frameClass="bg-line"
      key={(c) => c.name}
    >
      {#snippet item(chapter)}
        {@render chapterTile(chapter)}
      {/snippet}
    </VirtualGrid>
  {/if}
{/snippet}

{#snippet cover(sizeClass: string)}
  <div class="relative shrink-0 border-2 border-line {sizeClass}">
    {#if coverSrc.current && !coverFailed}
      <img
        src={coverSrc.current}
        alt={meta?.title ?? mangaName}
        class="absolute inset-0 h-full w-full object-cover"
        onerror={() => (coverFailed = true)}
      />
    {:else if reader.metaState === 'loading' || coverSrc.pending}
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
  <PageContainer>
    <div class="flex flex-col gap-6 pt-8">
      <BackLink label="LIBRARY" onclick={() => history.back()} />

      <h1 class="text-2xl leading-tight font-bold">{meta?.title || mangaName}</h1>

      {#if metaError && !meta}
        {#if savedProgress}
          <Button size="lg" variant="default" class="self-start" onclick={resume}>
            RESUME: {chapterLabel(savedProgress.chapter)}, p.{savedProgress.page + 1}
          </Button>
        {/if}
      {:else if isDesktop}
        <div class="flex items-start gap-6">
          {@render cover('h-56 w-40')}
          <div class="min-w-0 flex-1">
            {@render specTable()}
          </div>
        </div>

        {@render actions('items-center')}
      {:else}
        <div class="mx-auto">
          {@render cover('h-64 w-44')}
        </div>

        {@render specTable()}

        {@render actions('flex-wrap')}
      {/if}
    </div>
  </PageContainer>

  <!-- Same width as the metadata above; ListPanel's own px-4 makes up the
       rest of PageContainer's md:px-8, so the edges line up. -->
  <div class="mx-auto mt-6 flex w-full max-w-4xl flex-1 flex-col md:px-4">
    <ListPanel label="CHAPTERS ({chapters.length})" bind:search placeholder="Search chapters…">
      {#snippet actions()}
        <button
          class="hit relative flex size-8 cursor-pointer items-center justify-center text-faint hover:bg-fg/10 hover:text-soft pointer-coarse:size-10"
          onclick={toggleSort}
          aria-label={descending ? 'Sort oldest first' : 'Sort newest first'}
          title={descending ? 'Newest first' : 'Oldest first'}
        >
          {#if descending}<ArrowDown10 size={18} />{:else}<ArrowDown01 size={18} />{/if}
        </button>
      {/snippet}
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
