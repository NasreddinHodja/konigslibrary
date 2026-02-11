<script lang="ts">
  import { Menu, X, Minus, Plus, ArrowRightLeft, ScrollText, BookOpen } from 'lucide-svelte';
  import { manga, setZip } from '$lib/state.svelte';
  import ChapterList from '$lib/ChapterList.svelte';
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
</script>

<svelte:document
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
/>

{#if manga.sidebarOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
    onclick={() => (manga.sidebarOpen = false)}
  ></div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside
  class="fixed top-0 left-0 z-50 flex h-full w-80 flex-col border-r-2 bg-black shadow-xl transition-transform duration-300"
  style="transform: translateX({manga.sidebarOpen
    ? '0'
    : isMobile
      ? '-100%'
      : 'calc(-100% + 3.25rem)'})"
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  {#if !manga.sidebarOpen && !isMobile}
    <div
      class="absolute inset-0 z-10 cursor-pointer"
      onclick={() => (manga.sidebarOpen = true)}
    ></div>
  {/if}
  <button
    class="absolute top-2 right-2 z-20 p-2 hover:bg-white/10"
    onclick={() => (manga.sidebarOpen = !manga.sidebarOpen)}
  >
    {#if manga.sidebarOpen}<X size={20} />{:else}<Menu size={20} />{/if}
  </button>

  <div
    class="flex flex-1 flex-col overflow-hidden transition-opacity duration-300"
    style="opacity: {manga.sidebarOpen ? '1' : '0'}; pointer-events: {manga.sidebarOpen
      ? 'auto'
      : 'none'}"
  >
    <div class="space-y-4 p-6 pt-14">
      <h2 class="text-xl font-bold">KONIGSLIBRARY</h2>
      <label class="block w-full cursor-pointer border-2 px-3 py-2 text-left hover:bg-white/20">
        Upload manga
        <input type="file" accept=".zip,.cbz" onchange={handleZip} class="hidden" />
      </label>
    </div>

    <div class="flex-1 space-y-2 overflow-y-auto px-6">
      <ChapterList />
    </div>

    <div class="flex shrink-0 flex-col gap-4 border-t border-white/20 p-4">
      <div class="flex items-center justify-center gap-2">
        <button
          class="px-3 py-1 hover:bg-white/20"
          onclick={() => (manga.zoom = Math.max(0.5, manga.zoom - 0.1))}
        >
          <Minus size={16} />
        </button>
        <span class="w-16 text-center text-sm opacity-80">
          {manga.zoom.toFixed(2)}x
        </span>
        <button
          class="px-3 py-1 hover:bg-white/20"
          onclick={() => (manga.zoom = Math.min(1, manga.zoom + 0.1))}
        >
          <Plus size={16} />
        </button>
      </div>
      <button
        class="flex w-full items-center justify-center gap-2 border-2 px-3 py-2 text-sm hover:bg-white/20"
        onclick={() => {
          manga.scrollMode = !manga.scrollMode;
          localStorage.setItem('kl:scrollMode', String(manga.scrollMode));
        }}
      >
        {#if manga.scrollMode}
          <ScrollText size={16} /> Scroll Mode
        {:else}
          <BookOpen size={16} /> Page Turn
        {/if}
      </button>

      <button
        class="flex w-full items-center justify-center gap-2 border-2 px-3 py-2 text-sm hover:bg-white/20"
        onclick={() => {
          manga.rtl = !manga.rtl;
          localStorage.setItem('kl:rtl', String(manga.rtl));
        }}
      >
        <ArrowRightLeft size={16} />
        {manga.rtl ? 'Right to Left' : 'Left to Right'}
      </button>
    </div>
  </div>
</aside>
