<script lang="ts">
  import { slide } from 'svelte/transition';
  import { Menu, X, Minus, Plus, ArrowLeft, Download, Settings } from 'lucide-svelte';
  import {
    manga,
    setZip,
    clearManga,
    getSourceMode,
    getLibraryManga,
    getLibraryChapters,
    getMangaName,
    toggleScrollMode,
    toggleRtl,
    toggleDoublePage,
    zoomIn,
    zoomOut
  } from '$lib/state.svelte';
  import { saveChapter } from '$lib/download';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/constants';
  import ChapterList from '$lib/ChapterList.svelte';
  import Toggle from '$lib/ui/Toggle.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Backdrop from '$lib/ui/Backdrop.svelte';
  import {
    handleTouchStart,
    handleTouchEnd,
    createTouchMoveHandler
  } from '$lib/actions/edgeSwipe.svelte';

  let isMobile = $state(false);

  $effect(() => {
    const check = () => (isMobile = window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  });

  const handleZip = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;
    await setZip(input.files[0]);
  };

  const handleTouchMove = createTouchMoveHandler(
    () => {
      manga.sidebarOpen = true;
    },
    () => {
      manga.sidebarOpen = false;
    }
  );

  function startChapterDownload() {
    const slug = getLibraryManga();
    const name = getMangaName();
    const chapters = getLibraryChapters();
    if (!slug || !name || !manga.selectedChapter) return;
    const chapter = chapters.find((c) => c.name === manga.selectedChapter);
    if (!chapter) return;
    saveChapter(slug, name, chapter);
  }
</script>

<svelte:document
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
/>

{#if manga.sidebarOpen}
  <Backdrop onclick={() => (manga.sidebarOpen = false)} />
{/if}

<aside
  class="duration-anim fixed top-0 left-0 z-50 flex h-full w-80 flex-col border-r-2 bg-black shadow-xl transition-transform ease-anim"
  style="transform: translateX({manga.sidebarOpen
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
    class="duration-anim flex flex-1 flex-col overflow-hidden transition-opacity ease-anim"
    style="opacity: {manga.sidebarOpen ? '1' : '0'}; pointer-events: {manga.sidebarOpen
      ? 'auto'
      : 'none'}"
  >
    <div class="space-y-4 p-6" style="padding-top: calc(3.5rem + env(safe-area-inset-top))">
      <h2 class="pb-3 text-xl font-bold">KONIGSLIBRARY</h2>
      <div class="flex items-stretch justify-between gap-2">
        <Button size="md" onclick={clearManga}>
          <ArrowLeft size={16} class="inline" /> Back
        </Button>
        {#if getSourceMode() === 'library' || getSourceMode() === 'offline'}
          <Button size="icon" onclick={startChapterDownload}>
            <Download size={16} />
          </Button>
        {/if}
        <label class="flex cursor-pointer">
          <Button size="md" as="span">Upload</Button>
          <input type="file" accept=".zip,.cbz" onchange={handleZip} class="hidden" />
        </label>
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
