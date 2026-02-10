<script lang="ts">
  import { tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ChevronDown, ChevronRight } from 'lucide-svelte';
  import { manga, getChapters } from '$lib/state.svelte';
  import { ANIM_DURATION } from '$lib/constants';

  const chapters = $derived(getChapters());
  let listEl: HTMLUListElement;

  $effect(() => {
    if (manga.sidebarOpen && listEl) {
      setTimeout(() => {
        const active = listEl.querySelector('.underline') as HTMLElement | null;
        active?.scrollIntoView({ block: 'nearest' });
      }, ANIM_DURATION + 10);
    }
  });

  const toggleChapter = async (name: string, btn: HTMLElement) => {
    const scroller = btn.closest('.overflow-y-auto') as HTMLElement | null;
    const btnY = btn.getBoundingClientRect().top;

    if (manga.selectedChapter === name) {
      manga.selectedChapter = null;
      manga.currentPage = 0;
    } else {
      manga.selectedChapter = name;
      manga.currentPage = 0;
      if (window.innerWidth < 768) manga.sidebarOpen = false;
    }

    if (scroller) {
      await tick();
      const drift = btn.getBoundingClientRect().top - btnY;
      if (drift !== 0) scroller.scrollTop += drift;
    }
  };
</script>

<ul bind:this={listEl} class="space-y-2">
  {#each chapters as chapter}
    {@const isOpen = manga.selectedChapter === chapter.name}
    <li>
      <button
        class="flex w-full cursor-pointer items-center justify-between border-2 px-3 py-2 text-left
          {isOpen ? 'border-white' : 'border-transparent hover:bg-white/10'}"
        onclick={(e) => toggleChapter(chapter.name, e.currentTarget)}
      >
        <span class="truncate">{chapter.name}</span>
        {#if isOpen}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
      </button>

      {#if isOpen}
        <ul class="mt-1 space-y-1 overflow-hidden" in:slide={{ duration: ANIM_DURATION }}>
          {#each Array(chapter.pageCount) as _, i}
            <li>
              <button
                class="w-full cursor-pointer truncate pl-6 pr-2 py-1 text-left text-sm
                  {manga.currentPage === i ? 'underline' : 'hover:bg-white/10'}"
                onclick={() => {
                  manga.currentPage = i;
                  manga.shouldScroll = true;
                  if (window.innerWidth < 768) manga.sidebarOpen = false;
                }}
              >
                Page {i + 1}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {/each}
</ul>
