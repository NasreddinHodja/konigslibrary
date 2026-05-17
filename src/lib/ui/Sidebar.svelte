<script lang="ts">
  import { Menu, X, Minus, Plus, ArrowLeft, Settings } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import { SIDEBAR_WIDTH_PX } from '$lib/utils/constants';
  import ChapterList from '$lib/chapters/ChapterList.svelte';
  import Toggle from '$lib/ui/Toggle.svelte';
  import Backdrop from '$lib/ui/Backdrop.svelte';
  import { drawer, createDrawerHandlers } from '$lib/actions/edgeSwipe.svelte';

  const svc = getReaderContext();
  const { state: manga, clearManga, toggleScrollMode, toggleRtl, zoomIn, zoomOut } = svc;

  const mangaName = $derived(svc.provider?.mangaName ?? '');

  let isMobile = $state(false);

  $effect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    isMobile = mql.matches;
    const onChange = (e: MediaQueryListEvent) => (isMobile = e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  const { handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel } =
    createDrawerHandlers({
      sidebarWidth: SIDEBAR_WIDTH_PX,
      isOpen: () => manga.sidebarOpen,
      onSnap: (open) => {
        manga.sidebarOpen = open;
      }
    });

  const sidebarTransform = $derived(
    drawer.dragging
      ? `${(drawer.progress - 1) * 100}%`
      : manga.sidebarOpen
        ? '0'
        : '-100%'
  );
</script>

<svelte:document
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
  ontouchcancel={handleTouchCancel}
/>

{#if drawer.dragging || manga.sidebarOpen}
  <Backdrop
    onclick={() => (manga.sidebarOpen = false)}
    opacity={drawer.dragging ? drawer.progress * 0.5 : 0.5}
  />
{/if}

<aside
  class="fixed top-0 left-0 z-50 flex h-full w-80 flex-col border-r-2 bg-black {drawer.dragging
    ? ''
    : 'duration-anim transition-transform ease-anim'}"
  style="padding-left: var(--safe-left); transform: translateX({sidebarTransform})"
>
  <!-- Toggle button — visible when sidebar is open -->
  <div class="absolute right-3 z-20" style="top: calc(0.875rem + var(--safe-top))">
    <button
      class="cursor-pointer p-1 opacity-40 hover:opacity-100"
      onclick={() => (manga.sidebarOpen = !manga.sidebarOpen)}
      aria-label={manga.sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
    >
      {#if manga.sidebarOpen}<X size={18} />{:else}<Menu size={18} />{/if}
    </button>
  </div>

  <!-- Content that fades when collapsed -->
  <div
    class="flex flex-1 flex-col overflow-hidden {drawer.dragging
      ? ''
      : 'duration-anim transition-opacity ease-anim'}"
    style="opacity: {drawer.dragging
      ? drawer.progress
      : manga.sidebarOpen
        ? '1'
        : '0'}; pointer-events: {manga.sidebarOpen ? 'auto' : 'none'}"
  >
    <!-- Header: back link + manga title -->
    <div class="shrink-0 px-4 pr-10" style="padding-top: calc(0.875rem + var(--safe-top))">
      <button
        class="mb-3 flex cursor-pointer items-center gap-1.5 text-xs tracking-widest opacity-30 hover:opacity-80"
        onclick={clearManga}
      >
        <ArrowLeft size={12} />
        LIBRARY
      </button>
      <h1 class="text-xl font-bold leading-snug break-words">{mangaName}</h1>
    </div>

    <div class="mx-4 mt-4 mb-0 border-t border-white/10"></div>

    <!-- Chapter list -->
    <div class="flex-1 overflow-y-auto">
      <ChapterList />
    </div>

    <!-- Controls -->
    <div
      class="shrink-0 space-y-3 border-t border-white/10 p-4"
      style="padding-bottom: calc(1rem + var(--safe-bottom))"
    >
      {#if manga.scrollMode}
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold tracking-widest opacity-30">ZOOM</span>
          <div class="flex items-center gap-3">
            <button class="cursor-pointer p-1 opacity-40 hover:opacity-100" onclick={zoomOut}>
              <Minus size={14} />
            </button>
            <span class="w-10 text-center text-sm tabular-nums">
              {Math.round(manga.zoom * 100)}%
            </span>
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
</aside>
