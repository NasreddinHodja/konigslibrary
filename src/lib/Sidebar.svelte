<script lang="ts">
  import { slide } from 'svelte/transition';
  import { Menu, X, Minus, Plus, ArrowLeft, Settings } from 'lucide-svelte';
  import {
    manga,
    clearManga,
    toggleScrollMode,
    toggleRtl,
    toggleDoublePage,
    zoomIn,
    zoomOut
  } from '$lib/state.svelte';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/constants';
  import ChapterList from '$lib/ChapterList.svelte';
  import Toggle from '$lib/ui/Toggle.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Backdrop from '$lib/ui/Backdrop.svelte';
  import { drawer, createDrawerHandlers } from '$lib/actions/edgeSwipe.svelte';

  let isMobile = $state(false);

  $effect(() => {
    const check = () => (isMobile = window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  });

  const { handleTouchStart, handleTouchMove, handleTouchEnd } = createDrawerHandlers({
    sidebarWidth: 320,
    isOpen: () => manga.sidebarOpen,
    onSnap: (open) => {
      manga.sidebarOpen = open;
    }
  });
</script>

<svelte:document
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
/>

{#if drawer.dragging || manga.sidebarOpen}
  <Backdrop
    onclick={() => (manga.sidebarOpen = false)}
    opacity={drawer.dragging ? drawer.progress * 0.5 : 0.5}
  />
{/if}

<aside
  class="fixed top-0 left-0 z-50 flex h-full w-80 flex-col border-r-2 bg-black shadow-xl {drawer.dragging
    ? ''
    : 'duration-anim transition-transform ease-anim'}"
  style="transform: translateX({drawer.dragging
    ? `${(drawer.progress - 1) * 100}%`
    : manga.sidebarOpen
      ? '0'
      : isMobile
        ? '-100%'
        : 'calc(-100% + var(--sidebar-peek))'})"
>
  {#if !manga.sidebarOpen && !isMobile}
    <button
      class="absolute inset-0 z-10 cursor-pointer"
      aria-label="Open sidebar"
      onclick={() => (manga.sidebarOpen = true)}
    ></button>
  {/if}
  <div class="absolute right-2 z-20" style="top: calc(0.5rem + env(safe-area-inset-top))">
    <Button size="icon" onclick={() => (manga.sidebarOpen = !manga.sidebarOpen)}>
      {#if manga.sidebarOpen}<X size={20} />{:else}<Menu size={20} />{/if}
    </Button>
  </div>

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
    <div class="space-y-4 p-6" style="padding-top: calc(3.5rem + env(safe-area-inset-top))">
      <div class="flex items-center gap-3">
        <Button size="icon" onclick={clearManga}>
          <ArrowLeft size={16} />
        </Button>
        <h2 class="text-xl font-bold">KONIGSLIBRARY</h2>
      </div>
    </div>

    <div class="flex-1 space-y-2 overflow-y-auto px-6">
      <ChapterList />
    </div>

    <div class="flex shrink-0 flex-col gap-4 border-t border-white/20 p-4">
      {#if manga.scrollMode}
        <div
          class="flex items-center justify-center gap-2"
          transition:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
        >
          <Button size="icon" onclick={zoomOut}>
            <Minus size={16} />
          </Button>
          <span class="w-16 text-center text-sm opacity-80">
            {manga.zoom.toFixed(2)}x
          </span>
          <Button size="icon" onclick={zoomIn}>
            <Plus size={16} />
          </Button>
        </div>
      {/if}
      <div class="flex flex-col gap-3">
        {#if !manga.scrollMode}
          <div
            class="flex flex-col gap-3"
            transition:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
          >
            <Toggle labelA="LTR" labelB="RTL" active={manga.rtl} onclick={toggleRtl} />
            <Toggle
              labelA="Single"
              labelB="Double"
              active={manga.doublePage}
              onclick={toggleDoublePage}
            />
          </div>
        {/if}
        <Toggle
          labelA="Turn"
          labelB="Scroll"
          active={manga.scrollMode}
          locked={manga.doublePage}
          onclick={toggleScrollMode}
        />
      </div>
      <a
        href="/settings"
        class="flex items-center justify-center gap-2 py-1 text-sm opacity-40 hover:opacity-80"
      >
        <Settings size={14} />
        Settings
      </a>
    </div>
  </div>
</aside>
