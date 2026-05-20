<script lang="ts">
  import { ArrowLeft, Minus, Plus, Settings } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import Toggle from '$lib/ui/Toggle.svelte';

  let {
    visible,
    onback
  }: {
    visible: boolean;
    onback: () => void;
  } = $props();

  const svc = getReaderContext();
  const { state: manga, toggleScrollMode, toggleRtl, zoomIn, zoomOut } = svc;

  const mangaName = $derived(svc.provider?.mangaName ?? '');
  const chapters = $derived(svc.chapters);
  const totalPages = $derived(chapters.find((c) => c.name === manga.selectedChapter)?.pageCount ?? 0);
  const progress = $derived(totalPages > 0 ? ((manga.currentPage + 1) / totalPages) * 100 : 0);

</script>

<!-- Top bar -->
<div
  class="fixed inset-x-0 top-0 z-40 flex items-center gap-4 border-b border-white/10 px-4 transition-transform duration-200 ease-out
    {visible ? 'pointer-events-auto translate-y-0' : 'pointer-events-none -translate-y-full'}"
  style="background: rgba(0,0,0,0.92); padding-top: calc(0.75rem + var(--safe-top)); padding-bottom: 0.75rem;"
>
  <button
    class="shrink-0 cursor-pointer p-1 opacity-50 hover:opacity-100"
    onclick={onback}
    aria-label="Back"
  >
    <ArrowLeft size={18} />
  </button>

  <div class="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
    <span class="shrink-0 truncate text-sm font-bold">{mangaName}</span>
    {#if manga.selectedChapter}
      <span class="shrink-0 text-xs opacity-30">·</span>
      <span class="truncate text-xs opacity-50">{manga.selectedChapter}</span>
    {/if}
  </div>

  <span class="shrink-0 text-xs tabular-nums opacity-40">
    {manga.currentPage + 1} / {totalPages}
  </span>

</div>

<!-- Bottom controls bar -->
<div
    class="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 px-4 transition-transform duration-200 ease-out
      {visible ? 'pointer-events-auto translate-y-0' : 'pointer-events-none translate-y-full'}"
    style="background: rgba(0,0,0,0.92); padding-top: 1rem; padding-bottom: calc(1rem + var(--safe-bottom, 0px));"
  >
    <div class="mx-auto w-full max-w-xs space-y-3">
      {#if manga.scrollMode}
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold tracking-widest opacity-30">ZOOM</span>
          <div class="flex items-center gap-3">
            <button class="cursor-pointer p-1 opacity-40 hover:opacity-100" onclick={zoomOut}>
              <Minus size={14} />
            </button>
            <span class="w-10 text-center text-sm tabular-nums">{Math.round(manga.zoom * 100)}%</span>
            <button class="cursor-pointer p-1 opacity-40 hover:opacity-100" onclick={zoomIn}>
              <Plus size={14} />
            </button>
          </div>
        </div>
      {/if}

      {#if !manga.scrollMode}
        <Toggle labelA="LTR" labelB="RTL" active={manga.rtl} onclick={toggleRtl} />
      {/if}

      <Toggle labelA="Turn" labelB="Scroll" active={manga.scrollMode} onclick={toggleScrollMode} />

      <a
        href="/settings"
        class="flex items-center justify-center gap-1.5 pt-1 text-xs tracking-widest opacity-20 hover:opacity-60"
      >
        <Settings size={12} />
        SETTINGS
      </a>
    </div>
  </div>

<!-- Bottom progress line -->
<div class="pointer-events-none fixed inset-x-0 z-40" style="bottom: var(--safe-bottom, 0px)">
  <div class="h-px bg-white/10">
    <div
      class="h-full bg-white transition-[width,opacity] duration-300 ease-out"
      style="width: {progress}%; opacity: {visible ? 0.65 : 0.18}"
    ></div>
  </div>
</div>
