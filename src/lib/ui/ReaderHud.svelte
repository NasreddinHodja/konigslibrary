<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import { ArrowLeft, Minus, Plus, Settings } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import Toggle from '$lib/ui/Toggle.svelte';
  import PagePicker from '$lib/ui/PagePicker.svelte';

  let {
    visible,
    onback
  }: {
    visible: boolean;
    onback: () => void;
  } = $props();

  const reader = getReaderContext();
  const { state: manga, toggleScrollMode, toggleRtl, zoomIn, zoomOut } = reader;

  const mangaName = $derived(reader.provider?.mangaName ?? '');
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
  class="fixed inset-x-0 top-0 z-40 flex items-center gap-4 border-b border-border/25 bg-surface/60 px-4 backdrop-blur-2xl transition-transform duration-200 ease-out
    {shown ? 'pointer-events-auto translate-y-0' : 'pointer-events-none -translate-y-full'}"
  style="padding-top: calc(0.75rem + var(--safe-top)); padding-bottom: 0.75rem;"
>
  <button
    class="shrink-0 cursor-pointer p-1 opacity-70 hover:opacity-100"
    onclick={onback}
    aria-label="Back"
  >
    <ArrowLeft size={18} />
  </button>

  <div class="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
    <span class="shrink-0 truncate text-sm font-bold">{mangaName}</span>
    {#if manga.selectedChapter}
      <span class="shrink-0 text-xs opacity-50">·</span>
      <span class="truncate text-xs opacity-70">{manga.selectedChapter}</span>
    {/if}
  </div>

  <button
    class="shrink-0 cursor-pointer text-xs tabular-nums hover:opacity-70"
    onclick={() => (pickerOpen = true)}
    title="Jump to page"
  >
    {manga.currentPage + 1} / {totalPages}
  </button>
</div>

<!-- Bottom controls island -->
<div
  class="fixed bottom-4 left-1/2 z-40 w-full max-w-xs -translate-x-1/2 border border-border/25 bg-surface/60 px-4 backdrop-blur-2xl transition-transform duration-200 ease-out
      {shown
    ? 'pointer-events-auto translate-y-0'
    : 'pointer-events-none translate-y-[calc(100%+1rem)]'}"
  style="padding-top: 1rem; padding-bottom: calc(1rem + var(--safe-bottom, 0px));"
>
  <div class="w-full space-y-3">
    {#if manga.scrollMode}
      <div
        class="flex items-center justify-between overflow-hidden"
        in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
        out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
      >
        <span class="text-xs font-bold tracking-widest">ZOOM</span>
        <div class="flex items-center gap-3">
          <button class="cursor-pointer p-1 opacity-70 hover:opacity-100" onclick={zoomOut} aria-label="Zoom out">
            <Minus size={14} />
          </button>
          <span class="w-10 text-center text-sm tabular-nums">{Math.round(manga.zoom * 100)}%</span>
          <button class="cursor-pointer p-1 opacity-70 hover:opacity-100" onclick={zoomIn} aria-label="Zoom in">
            <Plus size={14} />
          </button>
        </div>
      </div>
    {/if}

    {#if !manga.scrollMode}
      <div
        in:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
        out:slide={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
        class="overflow-hidden"
      >
        <Toggle labelA="LTR" labelB="RTL" active={manga.rtl} onclick={toggleRtl} />
      </div>
    {/if}

    <Toggle labelA="Turn" labelB="Scroll" active={manga.scrollMode} onclick={toggleScrollMode} />

    <a
      href="/settings"
      class="flex items-center justify-center gap-1.5 pt-1 text-xs tracking-widest opacity-60 hover:opacity-100"
    >
      <Settings size={12} />
      SETTINGS
    </a>
  </div>
</div>

<!-- Bottom progress line -->
<div class="pointer-events-none fixed inset-x-0 z-40" style="bottom: var(--safe-bottom, 0px)">
  <div class="h-px bg-fg/10">
    <div
      class="h-full bg-fg transition-[width,opacity] duration-300 ease-out"
      style="width: {progress}%; opacity: {shown ? 0.65 : 0.18}"
    ></div>
  </div>
</div>

<PagePicker visible={pickerOpen} onclose={() => (pickerOpen = false)} />
