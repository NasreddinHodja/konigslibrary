<script lang="ts">
  import { Menu, X, Minus, Plus } from 'lucide-svelte';
  import { manga, setZip } from '$lib/state.svelte';
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
</script>

<svelte:document
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
/>

{#if manga.sidebarOpen}
  <Backdrop onclick={() => (manga.sidebarOpen = false)} />
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
  <div class="absolute top-2 right-2 z-20">
    <Button size="icon" onclick={() => (manga.sidebarOpen = !manga.sidebarOpen)}>
      {#if manga.sidebarOpen}<X size={20} />{:else}<Menu size={20} />{/if}
    </Button>
  </div>

  <div
    class="flex flex-1 flex-col overflow-hidden transition-opacity duration-300"
    style="opacity: {manga.sidebarOpen ? '1' : '0'}; pointer-events: {manga.sidebarOpen
      ? 'auto'
      : 'none'}"
  >
    <div class="space-y-4 p-6 pt-14">
      <h2 class="text-xl font-bold pb-3">KONIGSLIBRARY</h2>
      <label class="block w-full cursor-pointer text-left">
        <Button size="md" as="span">Upload manga</Button>
        <input type="file" accept=".zip,.cbz" onchange={handleZip} class="hidden" />
      </label>
    </div>

    <div class="flex-1 space-y-2 overflow-y-auto px-6">
      <ChapterList />
    </div>

    <div class="flex shrink-0 flex-col gap-4 border-t border-white/20 p-4">
      <div class="flex items-center justify-center gap-2">
        <Button size="icon" onclick={() => (manga.zoom = Math.max(0.5, manga.zoom - 0.1))}>
          <Minus size={16} />
        </Button>
        <span class="w-16 text-center text-sm opacity-80">
          {manga.zoom.toFixed(2)}x
        </span>
        <Button size="icon" onclick={() => (manga.zoom = Math.min(1, manga.zoom + 0.1))}>
          <Plus size={16} />
        </Button>
      </div>
      <div class="flex flex-col gap-3">
        <Toggle
          labelA="Page"
          labelB="Scroll"
          active={manga.scrollMode}
          onclick={() => {
            manga.scrollMode = !manga.scrollMode;
            localStorage.setItem('kl:scrollMode', String(manga.scrollMode));
          }}
        />
        <Toggle
          labelA="LTR"
          labelB="RTL"
          active={manga.rtl}
          onclick={() => {
            manga.rtl = !manga.rtl;
            localStorage.setItem('kl:rtl', String(manga.rtl));
          }}
        />
      </div>
    </div>
  </div>
</aside>
