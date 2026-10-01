<script lang="ts">
  import { X, Search } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import VirtualGrid from '$lib/ui/virtual/VirtualGrid.svelte';
  import CoverThumbnail from '$lib/ui/CoverThumbnail.svelte';
  import { focusTrap } from '$lib/ui/focus-trap';

  // Mounted only while open, so it starts with an empty search each time.
  let { pageUrls, onclose }: { pageUrls: string[]; onclose: () => void } = $props();

  const reader = getReaderContext();
  const { state: manga, goToPage } = reader;

  let query = $state('');

  const totalPages = $derived(pageUrls.length);
  const chapterName = $derived(manga.selectedChapter ?? '');

  const filteredIndices = $derived.by(() => {
    const q = query.trim();
    const all = pageUrls.map((_, i) => i);
    return q ? all.filter((i) => String(i + 1).includes(q)) : all;
  });

  function pick(i: number) {
    goToPage(i, totalPages);
    onclose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    if (e.key === 'Enter' && filteredIndices.length === 1) pick(filteredIndices[0]);
  }
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-reader-bg/60 p-4 backdrop-blur-sm"
  style="padding-bottom: calc(1rem + var(--safe-bottom, 0px))"
  role="presentation"
  onclick={onclose}
>
  <!-- Modal -->
  <div
    class="flex h-full max-h-[85vh] w-full max-w-2xl flex-col border-2 border-border/35 bg-bg"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Jump to page"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKeydown}
    {@attach focusTrap}
  >
    <!-- Header -->
    <div class="flex shrink-0 items-center gap-3 border-b border-border/10 px-4 py-3">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="text-xs font-bold tracking-widest opacity-50">JUMP TO PAGE</span>
        {#if chapterName}
          <span class="truncate text-xs opacity-40">{chapterName}</span>
        {/if}
      </div>
      <button
        class="hit relative shrink-0 cursor-pointer p-1 opacity-60 hover:opacity-100"
        onclick={onclose}
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>

    <!-- Search bar -->
    <div
      class="flex shrink-0 items-center gap-3 border-b border-border/10 px-4 py-3 pointer-coarse:py-3.5"
    >
      <Search size={14} class="shrink-0 opacity-50" />
      <input
        {@attach (el) => {
          // After the dialog's focus trap has focused its first button.
          requestAnimationFrame(() => el.focus());
        }}
        bind:value={query}
        type="text"
        inputmode="numeric"
        placeholder="Page number…"
        class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
      />
      <span class="shrink-0 text-xs tabular-nums opacity-50">{totalPages} pages</span>
    </div>

    <!-- Grid -->
    {#if filteredIndices.length === 0}
      <p class="flex-1 py-12 text-center text-sm opacity-50">No pages match</p>
    {:else}
      <!-- Keyed so a new search starts back at the top. -->
      {#key query}
        <div class="flex-1 overflow-y-auto p-3">
          <VirtualGrid items={filteredIndices} minItemWidth={100} gap={8} key={String}>
            {#snippet item(i)}
              {@const url = pageUrls[i]}
              {@const isCurrent = i === manga.currentPage}
              <CoverThumbnail
                src={url || null}
                caption={String(i + 1)}
                alt="Go to page {i + 1}"
                active={isCurrent}
                objectPosition="top"
                onclick={() => pick(i)}
              >
                {#snippet placeholder()}
                  <div class="flex h-full w-full items-center justify-center opacity-20">
                    <span class="text-xs">{i + 1}</span>
                  </div>
                {/snippet}
              </CoverThumbnail>
            {/snippet}
          </VirtualGrid>
        </div>
      {/key}
    {/if}
  </div>
</div>
