<script lang="ts">
  import { ArrowLeft, Menu } from 'lucide-svelte';

  let {
    visible,
    mangaName = '',
    chapterName = null,
    currentPage = 0,
    totalPages = 0,
    onback,
    onmenu
  }: {
    visible: boolean;
    mangaName?: string;
    chapterName?: string | null;
    currentPage?: number;
    totalPages?: number;
    onback: () => void;
    onmenu: () => void;
  } = $props();

  const progress = $derived(totalPages > 0 ? ((currentPage + 1) / totalPages) * 100 : 0);
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
    aria-label="Back to library"
  >
    <ArrowLeft size={18} />
  </button>

  <div class="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
    <span class="shrink-0 truncate text-sm font-bold">{mangaName}</span>
    {#if chapterName}
      <span class="shrink-0 text-xs opacity-30">·</span>
      <span class="truncate text-xs opacity-50">{chapterName}</span>
    {/if}
  </div>

  <span class="shrink-0 text-xs tabular-nums opacity-40">
    {currentPage + 1} / {totalPages}
  </span>

  <button
    class="shrink-0 cursor-pointer p-1 opacity-50 hover:opacity-100"
    onclick={onmenu}
    aria-label="Open chapter menu"
  >
    <Menu size={18} />
  </button>
</div>

<!-- Bottom progress line — always rendered, brightens with HUD -->
<div class="pointer-events-none fixed inset-x-0 z-40" style="bottom: var(--safe-bottom, 0px)">
  <div class="h-px bg-white/10">
    <div
      class="h-full bg-white transition-[width,opacity] duration-300 ease-out"
      style="width: {progress}%; opacity: {visible ? 0.65 : 0.18}"
    ></div>
  </div>
</div>
