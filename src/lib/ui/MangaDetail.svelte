<script lang="ts">
  import Icon from './Icon.svelte';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
  import ListPanel from '$lib/ui/ListPanel.svelte';
  import { TILE, TILE_DESKTOP_QUERY } from '$lib/ui/tile-grid';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import Button from '$lib/ui/Button.svelte';
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
  /// While less shrinks the row, the tags it will remove fade out.
  let tagsFading = $state(false);

  /// The tags' laid-out height. Not scrollHeight: that counts overflow, and
  /// the more/less button's touch area (`hit`) reaches below the row.
  function naturalHeight(el: HTMLElement) {
    const set = el.style.height;
    el.style.height = 'auto';
    const h = el.offsetHeight;
    el.style.height = set;
    return h;
  }

  async function expandTags() {
    if (!tagsEl) {
      tagsExpanded = true;
      return;
    }
    tagsCollapsedH = naturalHeight(tagsEl);
    tagsEl.style.height = tagsCollapsedH + 'px';
    tagsEl.style.overflow = 'hidden';
    tagsExpanded = true;
    await tick();
    const to = naturalHeight(tagsEl);
    // naturalHeight's read laid it out at auto; without another reflow the
    // transition would start from auto, which doesn't animate.
    void tagsEl.offsetHeight;
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
    tagsEl.style.height = naturalHeight(tagsEl) + 'px';
    tagsEl.style.overflow = 'hidden';
    void tagsEl.offsetHeight; // force reflow so the browser registers the starting height
    tagsEl.style.transition = `height ${ANIM_DURATION}ms ease-out`;
    tagsEl.style.height = tagsCollapsedH + 'px';
    tagsFading = true;
    setTimeout(() => {
      tagsExpanded = false;
      tagsFading = false;
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
    // A cancelled download's files are deleted, then this: offer it again.
    const offDeleted = reader.events.on('download:deleted', check);
    return () => {
      offComplete();
      offError();
      offDeleted();
    };
  });

  function download() {
    confirmingDownload = false;
    if (!serverSource) return;
    // Hidden while it runs; the toast shows progress.
    downloaded = true;
    saveManga(serverSource.slug, reader.title, serverSource.getServerChapters(), reader.events);
  }

  /// "resume ch. 12 p. 4": the app's own words are lowercase.
  const resumeLabel = $derived(
    savedProgress
      ? `resume ${chapterLabel(savedProgress.chapter).toLowerCase()} p. ${savedProgress.page + 1}`
      : ''
  );

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

{#snippet fact(key: string, value: string)}
  <!-- The leader runs under the whole first line; the key and the value's
       text cover it, so it ends where a wrapped value's first line starts,
       not at the left of the box the value wraps in. -->
  <div class="relative flex items-baseline">
    <span
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 flex items-baseline"
      ><span class="invisible">&nbsp;</span><span class="flex-1 border-b border-dotted border-ink3"
      ></span></span
    >
    <span class="relative shrink-0 bg-bg pr-2 text-dim">{key}</span>
    <span class="ml-4 min-w-0 flex-1 text-right wrap-break-word"
      ><span class="relative bg-bg pl-2">{value}</span></span
    >
  </div>
{/snippet}

{#snippet tags()}
  <div class="flex flex-wrap items-baseline gap-x-2" bind:this={tagsEl}>
    <span class="text-dim">tags</span>
    {#if meta && meta.tags.length}
      <!-- The fade is local: only tags added by more fade in, not the list as
           it loads; less fades them out as the row shrinks. The comma fades
           with its tag. -->
      <span
        >{#each meta.tags.slice(0, tagsExpanded ? TAGS_EXPANDED : TAGS_COLLAPSED) as tag, i (tag)}<span
            class="transition-opacity duration-(--duration-anim) ease-out {tagsFading &&
            i >= TAGS_COLLAPSED
              ? 'opacity-0'
              : ''}"
            in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
            >{i > 0 ? ', ' : ''}<span>{tag}</span></span
          >{/each}</span
      >
      {#if tagsExpanded}
        <button
          class="hit relative cursor-pointer text-ink hover:text-hi hover:underline"
          onclick={collapseTags}>less</button
        >
      {:else if meta.tags.length > TAGS_COLLAPSED}
        <button
          class="hit relative cursor-pointer text-ink hover:text-hi hover:underline"
          onclick={expandTags}>more</button
        >
      {/if}
    {:else}
      <span class="text-dim">—</span>
    {/if}
  </div>
{/snippet}

{#snippet facts()}
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    {#if meta}
      <div class="flex flex-col gap-1" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
        {@render fact('status', meta.status || '—')}
        {@render fact('author', meta.authors.join(', ') || '—')}
        {@render fact('year', meta.year ? String(meta.year) : '—')}
        {@render tags()}
      </div>
    {:else}
      {#each ['author', 'year'] as key (key)}
        <div class="flex items-center gap-2">
          <span class="text-dim">{key}</span>
          <Skeleton class="h-4 flex-1" />
        </div>
      {/each}
    {/if}
  </div>
{/snippet}

{#snippet actions()}
  {#if savedProgress || canDownload}
    <div class="flex flex-wrap gap-3">
      {#if savedProgress}
        <Button variant="primary" class="max-md:w-full" onclick={resume}>{resumeLabel}</Button>
      {/if}
      {#if canDownload}
        <Button class="max-md:w-full" onclick={() => (confirmingDownload = true)}
          ><Icon name="download" /> download</Button
        >
      {/if}
    </div>
  {/if}
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
    <p class="py-8 text-center text-dim" in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}>
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
      frameClass="bg-ink3"
      key={(c) => c.name}
    >
      {#snippet item(chapter)}
        {@render chapterTile(chapter)}
      {/snippet}
    </VirtualGrid>
  {/if}
{/snippet}

{#snippet cover(sizeClass: string)}
  <div class="relative shrink-0 border-3 border-double border-ink {sizeClass}">
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
      <div class="flex h-full w-full items-center justify-center text-dim">no cover</div>
    {/if}
  </div>
{/snippet}

<!-- One page scroll for both layouts: the metadata scrolls away and the
     chapters' bar pins below the status bar, like the library's. -->
<div
  class="relative flex min-h-dvh w-full flex-col {showShell
    ? 'pb-[calc(5.5rem_+_var(--safe-bottom))] md:pb-3'
    : 'pb-[calc(2rem_+_var(--safe-bottom))]'}"
  style="padding-top: var(--safe-top)"
>
  <div class="relative mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 px-3 pt-3 md:px-8">
    <div class="flex flex-col gap-3 panel p-3">
      <BackLink label="library" onclick={() => history.back()} />

      <h1 class="border-b border-ink text-2xl">{meta?.title || mangaName}</h1>

      {#if metaError && !meta}
        {@render actions()}
      {:else}
        <!-- On a phone the facts go under the cover: beside it they'd get about
             21 characters a line. -->
        <div class="flex gap-3 {isDesktop ? '' : 'flex-col'}">
          {@render cover(isDesktop ? 'h-72 w-48' : 'aspect-[2/3] w-44 self-center')}
          {@render facts()}
        </div>
        {@render actions()}
      {/if}
    </div>

    <ListPanel label="chapters ({chapters.length})" bind:search placeholder="Search chapters…">
      {#snippet actions()}
        <button
          class="hit relative flex cursor-pointer items-center text-ink hover:text-hi hover:underline"
          onclick={toggleSort}
          aria-label={descending ? 'Sort oldest first' : 'Sort newest first'}
        >
          <span class="flex items-center gap-2"
            ><Icon name={descending ? 'down' : 'up'} />{descending ? 'newest' : 'oldest'}</span
          >
        </button>
      {/snippet}
      {@render chapterGrid()}
    </ListPanel>
  </div>
</div>

{#if confirmingDownload}
  <ConfirmDialog
    message={`Download "${reader.title}"? This may take a while depending on size.`}
    confirmLabel="download"
    onconfirm={download}
    oncancel={() => (confirmingDownload = false)}
  />
{/if}
