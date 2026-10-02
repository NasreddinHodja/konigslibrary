<script lang="ts">
  import { ArrowLeft, Minus, Plus, Settings } from 'lucide-svelte';
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
  class="fixed inset-x-0 top-0 z-40 flex items-center gap-4 bg-surface/85 px-4 backdrop-blur-2xl transition-transform duration-200 ease-out
    {shown ? 'pointer-events-auto translate-y-0' : 'pointer-events-none -translate-y-full'}"
  style="padding-top: calc(0.75rem + var(--safe-top)); padding-bottom: 0.75rem;"
  inert={!shown}
>
  <button
    class="hit relative shrink-0 cursor-pointer p-1 opacity-70 hover:opacity-100"
    onclick={onback}
    aria-label="Back"
  >
    <ArrowLeft size={18} />
  </button>

  <div class="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
    <span class="shrink-0 truncate text-sm font-bold">{mangaName}</span>
    {#if manga.selectedChapter}
      <span class="shrink-0 text-xs opacity-50">·</span>
      <span class="truncate text-xs opacity-70">{chapterLabel(manga.selectedChapter)}</span>
    {/if}
  </div>

  <button
    class="hit relative shrink-0 cursor-pointer text-xs tabular-nums hover:opacity-70"
    onclick={() => (pickerOpen = true)}
    title="Jump to page"
  >
    {manga.currentPage + 1} / {totalPages}
  </button>

  <!-- Chapter progress line -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border/25">
    <div
      class="h-full bg-fg/65 transition-[width] duration-300 ease-out"
      style="width: {progress}%"
    ></div>
  </div>
</div>

<!-- Bottom controls island -->
<div
  class="fixed bottom-4 left-1/2 z-40 w-full max-w-xs -translate-x-1/2 border border-border/25 bg-surface/85 px-4 backdrop-blur-2xl transition-transform duration-200 ease-out
      {shown
    ? 'pointer-events-auto translate-y-0'
    : 'pointer-events-none translate-y-[calc(100%+1rem)]'}"
  style="padding-top: 1rem; padding-bottom: calc(1rem + var(--safe-bottom, 0px));"
  inert={!shown}
>
  <div class="w-full space-y-3">
    <!-- Mode-dependent controls share one grid cell so swapping them never changes the island height -->
    <div class="grid">
      <div
        class="col-start-1 row-start-1 flex items-center justify-between transition-opacity duration-150 ease-out
          {manga.scrollMode ? 'opacity-100 delay-150' : 'pointer-events-none opacity-0'}"
        inert={!manga.scrollMode}
      >
        <span class="text-xs font-bold tracking-widest">ZOOM</span>
        <div class="flex items-center gap-3">
          <button
            class="hit relative cursor-pointer p-1 opacity-70 hover:opacity-100"
            onclick={zoomOut}
            aria-label="Zoom out"
          >
            <Minus size={14} />
          </button>
          <span class="w-10 text-center text-sm tabular-nums">{Math.round(manga.zoom * 100)}%</span>
          <button
            class="hit relative cursor-pointer p-1 opacity-70 hover:opacity-100"
            onclick={zoomIn}
            aria-label="Zoom in"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div
        class="col-start-1 row-start-1 transition-opacity duration-150 ease-out
          {manga.scrollMode ? 'pointer-events-none opacity-0' : 'opacity-100 delay-150'}"
        inert={manga.scrollMode}
      >
        <Toggle labelA="LTR" labelB="RTL" active={manga.rtl} onclick={toggleRtl} />
      </div>
    </div>

    <Toggle labelA="Turn" labelB="Scroll" active={manga.scrollMode} onclick={toggleScrollMode} />

    <a
      href="/settings"
      class="hit relative flex items-center justify-center gap-1.5 pt-1 text-xs tracking-widest opacity-60 hover:opacity-100"
    >
      <Settings size={12} />
      SETTINGS
    </a>
  </div>
</div>

{#if pickerOpen}
  <PagePicker {pageUrls} onclose={() => (pickerOpen = false)} />
{/if}
