<script lang="ts">
  import { slide } from 'svelte/transition';
  import { manga, getChapters, saveLastChapter } from '$lib/state.svelte';

  const chapters = $derived(getChapters());

  let expandedChapter: string | null = $state(null);

  const toggleChapter = (chapter: (typeof chapters)[0]) => {
    if (expandedChapter === chapter.name) {
      expandedChapter = null;
      manga.selectedChapter = null;
    } else {
      expandedChapter = chapter.name;
      manga.selectedChapter = chapter;
      manga.currentPage = 0;
      saveLastChapter(chapter.name);
      if (window.innerWidth < 768) manga.sidebarOpen = false;
    }
  };
</script>

<ul class="space-y-2">
  {#each chapters as chapter}
    {@const isOpen = expandedChapter === chapter.name}
    <li>
      <button
        class="flex w-full cursor-pointer items-center justify-between border-2 px-3 py-2 text-left
          {isOpen ? 'border-white' : 'border-black hover:bg-white/10'}"
        onclick={() => toggleChapter(chapter)}
      >
        <span class="truncate">{chapter.name}</span>
        <span>{isOpen ? '▾' : '▸'}</span>
      </button>

      {#if isOpen}
        <ul class="ml-6 mt-1 space-y-1 overflow-hidden" transition:slide={{ duration: 200 }}>
          {#each chapter.files as _file, i}
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
