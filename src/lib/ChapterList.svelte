<script lang="ts">
  import { slide } from 'svelte/transition';
  import { manga, getChapters } from '$lib/state.svelte';

  const chapters = $derived(getChapters());

  const toggleChapter = (name: string) => {
    if (manga.selectedChapter !== name) {
      manga.selectedChapter = name;
      manga.currentPage = 0;
      if (window.innerWidth < 768) manga.sidebarOpen = false;
    }
  };
</script>

<ul class="space-y-2">
  {#each chapters as chapter}
    {@const isOpen = manga.selectedChapter === chapter.name}
    <li>
      <button
        class="flex w-full cursor-pointer items-center justify-between border-2 px-3 py-2 text-left
          {isOpen ? 'border-white' : 'border-black hover:bg-white/10'}"
        onclick={() => toggleChapter(chapter.name)}
      >
        <span class="truncate">{chapter.name}</span>
        <span>{isOpen ? '▾' : '▸'}</span>
      </button>

      {#if isOpen}
        <ul class="mt-1 ml-6 space-y-1 overflow-hidden" transition:slide={{ duration: 200 }}>
          {#each Array(chapter.pageCount) as _, i}
            <li>
              <button
                class="w-full cursor-pointer truncate px-2 py-1 text-left text-sm
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
