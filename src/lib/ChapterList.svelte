<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ChevronDown, ChevronRight, Download } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import { saveChapter } from '$lib/download.svelte';
  import { getOfflineManga } from '$lib/offline-db';
  import { ServerLibraryProvider } from '$lib/sources/library';
  import { OfflineDbProvider } from '$lib/sources/offline';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/constants';

  const svc = getReaderContext();
  const { state: manga, events } = svc;

  const canDownload = $derived.by(() => {
    const p = svc.getProvider();
    return p instanceof ServerLibraryProvider || p instanceof OfflineDbProvider;
  });
  let downloadedChapters: Set<string> = $state.raw(new Set());

  function refreshOfflineChapters() {
    const p = svc.getProvider();
    const slug =
      p instanceof ServerLibraryProvider ? p.slug : p instanceof OfflineDbProvider ? p.slug : '';
    if (!slug || !canDownload) {
      downloadedChapters = new Set();
      return;
    }
    getOfflineManga(slug).then((entry) => {
      downloadedChapters = new Set(entry?.chapters.map((c) => c.name) ?? []);
    });
  }

  // Initial load + refresh on download complete
  $effect(() => {
    refreshOfflineChapters();
    const unsub = events.on('download:complete', () => refreshOfflineChapters());
    return unsub;
  });

  function downloadChapter(chapterName: string, e: MouseEvent) {
    e.stopPropagation();
    const p = svc.getProvider();
    if (!(p instanceof ServerLibraryProvider) && !(p instanceof OfflineDbProvider)) return;
    const slug = p.slug;
    const name = p.mangaName;
    const chapters = p.getServerChapters();
    const chapter = chapters.find((c) => c.name === chapterName);
    if (!chapter) return;
    saveChapter(slug, name, chapter, events);
  }

  const chapters = $derived(svc.chapters);
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
