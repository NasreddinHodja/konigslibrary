<script lang="ts">
  import { Menu, X } from 'lucide-svelte';
  import { manga, setFiles, getChapters } from '$lib/state.svelte';
  import ChapterList from '$lib/ChapterList.svelte';
  import {
    handleTouchStart,
    handleTouchEnd,
    createTouchMoveHandler
  } from '$lib/actions/edgeSwipe.svelte';

  const chapters = $derived(getChapters());

  let isMobile = $state(false);

  $effect(() => {
    const check = () => (isMobile = window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  });

  const handleFiles = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    setFiles(Array.from(input.files));
  };

  const handleTouchMove = createTouchMoveHandler(
    () => { manga.sidebarOpen = true; },
    () => { manga.sidebarOpen = false; }
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
    class="fixed inset-0 z-40 bg-black/50 transition-opacity duration-200"
    onclick={() => (manga.sidebarOpen = false)}
  ></div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside
  class="fixed top-0 left-0 z-50 flex h-full w-72 flex-col border-r-2 bg-black shadow-xl transition-transform duration-300"
  style="transform: translateX({manga.sidebarOpen ? '0' : isMobile ? '-100%' : 'calc(-100% + 3.25rem)'})"
>
  <button
    class="absolute top-2 right-2 z-10 p-2 hover:bg-white/10"
    onclick={() => (manga.sidebarOpen = !manga.sidebarOpen)}
  >
    {#if manga.sidebarOpen}<X size={20} />{:else}<Menu size={20} />{/if}
  </button>

  <div
    class="flex flex-1 flex-col overflow-hidden transition-opacity duration-300"
    style="opacity: {manga.sidebarOpen ? '1' : '0'}; pointer-events: {manga.sidebarOpen ? 'auto' : 'none'}"
  >
    <div class="space-y-4 p-6 pt-14">
      <h2 class="text-xl font-bold">KONIGSLIBRARY</h2>
      <label class="block w-full cursor-pointer border-2 px-3 py-2 text-left hover:bg-white/20">
        Upload manga
        <input
          type="file"
          accept="image/*"
          multiple
          onchange={handleFiles}
          class="hidden"
          webkitdirectory
        />
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
          −
        </button>
        <span class="w-16 text-center text-sm opacity-80">
          {manga.zoom.toFixed(2)}x
        </span>
        <button
          class="px-3 py-1 hover:bg-white/20"
          onclick={() => (manga.zoom = Math.min(1, manga.zoom + 0.1))}
        >
          +
        </button>
      </div>

      <button
        class="w-full border-2 px-3 py-2 text-sm hover:bg-white/20"
        onclick={() => (manga.scrollMode = !manga.scrollMode)}
      >
        {manga.scrollMode ? 'Scroll Mode' : 'Page Turn'}
      </button>
    </div>
  </div>
</aside>
