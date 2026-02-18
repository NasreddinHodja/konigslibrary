<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ChevronDown, ChevronRight, Download } from 'lucide-svelte';
  import {
    manga,
    getChapters,
    getSourceMode,
    getLibraryManga,
    getLibraryChapters,
    getMangaName
  } from '$lib/state.svelte';
  import { saveChapter, getDownloadVersion } from '$lib/download.svelte';
  import { getOfflineManga } from '$lib/offline-db';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/constants';

  const canDownload = $derived(getSourceMode() === 'library' || getSourceMode() === 'offline');
  let downloadedChapters: Set<string> = $state.raw(new Set());

  $effect(() => {
    getDownloadVersion();
    const slug = getLibraryManga();
    if (!slug || !canDownload) {
      downloadedChapters = new Set();
      return;
    }
    getOfflineManga(slug).then((entry) => {
      downloadedChapters = new Set(entry?.chapters.map((c) => c.name) ?? []);
    });
  });

  function downloadChapter(chapterName: string, e: MouseEvent) {
    e.stopPropagation();
    const slug = getLibraryManga();
    const name = getMangaName();
    const chapters = getLibraryChapters();
    if (!slug || !name) return;
    const chapter = chapters.find((c) => c.name === chapterName);
    if (!chapter) return;
    saveChapter(slug, name, chapter);
  }

  const chapters = $derived(getChapters());
  let listEl: HTMLUListElement;

  $effect(() => {
    if (manga.sidebarOpen && listEl) {
      setTimeout(() => {
        const active = listEl.querySelector('.underline') as HTMLElement | null;
        active?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, ANIM_DURATION + 10);
    }
  });

  const toggleChapter = (name: string, btn: HTMLElement) => {
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
      const start = performance.now();
      const pin = () => {
        const drift = btn.getBoundingClientRect().top - btnY;
        if (drift !== 0) scroller.scrollTop += drift;
        if (performance.now() - start < ANIM_DURATION) requestAnimationFrame(pin);
      };
      requestAnimationFrame(pin);
    }
  };
</script>

<ul bind:this={listEl} class="space-y-2">
  {#each chapters as chapter (chapter.name)}
    {@const isOpen = manga.selectedChapter === chapter.name}
    <li>
      <button
        class="flex w-full cursor-pointer items-center justify-between border-2 px-3 py-2 text-left
          {isOpen ? 'border-white' : 'border-transparent hover:bg-white/10'}"
        onclick={(e) => toggleChapter(chapter.name, e.currentTarget)}
      >
        <span class="truncate">{chapter.name}</span>
        <span class="ml-2 shrink-0 text-white/60">({chapter.pageCount})</span>
        {#if isOpen}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
      </button>

      {#if isOpen}
        <div
          class="mt-1 space-y-1 overflow-hidden"
          transition:slide={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
        >
          {#if canDownload && !downloadedChapters.has(chapter.name)}
            <button
              class="mt-1 mb-2 flex w-full cursor-pointer items-center justify-center gap-2 border-2 border-white px-3 py-2 text-sm hover:bg-white/10"
              onclick={(e) => downloadChapter(chapter.name, e)}
            >
              <Download size={16} />
              Download chapter
            </button>
          {/if}
          <ul class="space-y-1">
            {#each Array.from({ length: chapter.pageCount }, (_, i) => i) as i (i)}
              <li>
                <button
                  class="w-full cursor-pointer truncate py-1 pr-2 pl-6 text-left text-sm
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
        </div>
      {/if}
    </li>
  {/each}
</ul>
