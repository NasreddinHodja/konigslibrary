<script lang="ts">
  import Icon from '$lib/ui/Icon.svelte';
  import { getReaderContext } from '$lib/context';
  import { chapterLabel } from '$lib/utils/chapters';
  import Toggle from '$lib/ui/Toggle.svelte';
  import PagePicker from '$lib/ui/PagePicker.svelte';

  let {
    visible,
    pageUrls,
    onback
  }: {
    visible: boolean;
    pageUrls: string[];
    onback: () => void;
  } = $props();

  const reader = getReaderContext();
  const { state: manga, toggleScrollMode, toggleRtl, zoomIn, zoomOut } = reader;

  const mangaName = $derived(reader.title);
  const chapters = $derived(reader.chapters);
  const totalPages = $derived(
    chapters.find((c) => c.name === manga.selectedChapter)?.pageCount ?? 0
  );
  const progress = $derived(totalPages > 0 ? ((manga.currentPage + 1) / totalPages) * 100 : 0);

  let pickerOpen = $state(false);
  const shown = $derived(visible || pickerOpen);
</script>

<!-- Top bar -->
<div
  class="fixed inset-x-0 top-0 z-40 flex items-center gap-3 bg-bg px-3 transition-transform duration-(--duration-anim) ease-out
    {shown ? 'pointer-events-auto translate-y-0' : 'pointer-events-none -translate-y-full'}"
  style="padding-top: calc(0.5rem + var(--safe-top)); padding-bottom: 0.625rem;"
  inert={!shown}
>
  <button
    class="hit relative flex shrink-0 cursor-pointer items-center justify-center text-ink hover:text-hi"
    onclick={onback}
    aria-label="Back"
  >
    <Icon name="back" size={18} />
  </button>

  <div class="flex min-w-0 flex-1 flex-col">
    <span class="truncate">{mangaName}</span>
    {#if manga.selectedChapter}
      <span class="truncate text-dim">{chapterLabel(manga.selectedChapter)}</span>
    {/if}
  </div>

  <button
    class="hit relative flex h-8 shrink-0 cursor-pointer items-center border border-ink px-2 text-ink tabular-nums hover:bg-ink hover:text-bg pointer-coarse:h-10"
    onclick={() => (pickerOpen = true)}
    title="Jump to page"
  >
    {manga.currentPage + 1}/{totalPages}
  </button>

  <!-- The bar's bottom edge is the chapter's progress. -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-ink3">
    <div
      class="h-full bg-ink transition-[width] duration-(--duration-anim) ease-out"
      style="width: {progress}%"
    ></div>
  </div>
</div>

<!-- Bottom controls -->
<div
  class="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-xs -translate-x-1/2 panel p-3 transition-transform duration-(--duration-anim) ease-out
      {shown
    ? 'pointer-events-auto translate-y-0'
    : 'pointer-events-none translate-y-[calc(100%+1rem)]'}"
  style="padding-bottom: calc(0.75rem + var(--safe-bottom, 0px));"
  inert={!shown}
>
  <div class="flex w-full flex-col gap-3">
    <!-- Mode-dependent controls share one grid cell so swapping them never changes the panel's height -->
    <div class="grid">
      <div
        class="col-start-1 row-start-1 flex items-center justify-between transition-opacity duration-(--duration-anim) ease-out
          {manga.scrollMode ? 'opacity-100' : 'pointer-events-none opacity-0'}"
        inert={!manga.scrollMode}
      >
        <span class="text-dim">zoom</span>
        <div class="flex items-center gap-2">
          <button
            class="hit relative flex size-8 cursor-pointer items-center justify-center border border-ink text-ink hover:bg-ink hover:text-bg pointer-coarse:size-10"
            onclick={zoomOut}
            aria-label="Zoom out"
          >
            <Icon name="zoomOut" size={15} />
          </button>
          <span class="w-12 text-center tabular-nums">{Math.round(manga.zoom * 100)}%</span>
          <button
            class="hit relative flex size-8 cursor-pointer items-center justify-center border border-ink text-ink hover:bg-ink hover:text-bg pointer-coarse:size-10"
            onclick={zoomIn}
            aria-label="Zoom in"
          >
            <Icon name="zoomIn" size={15} />
          </button>
        </div>
      </div>

      <div
        class="col-start-1 row-start-1 transition-opacity duration-(--duration-anim) ease-out
          {manga.scrollMode ? 'pointer-events-none opacity-0' : 'opacity-100'}"
        inert={manga.scrollMode}
      >
        <Toggle labelA="ltr" labelB="rtl" active={manga.rtl} onclick={toggleRtl} />
      </div>
    </div>

    <Toggle labelA="turn" labelB="scroll" active={manga.scrollMode} onclick={toggleScrollMode} />

    <a
      href="/settings"
      class="hit relative flex items-center gap-2 self-center text-ink hover:text-hi hover:underline"
    >
      <Icon name="settings" />
      settings
    </a>
  </div>
</div>

{#if pickerOpen}
  <PagePicker {pageUrls} onclose={() => (pickerOpen = false)} />
{/if}
