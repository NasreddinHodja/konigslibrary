<script lang="ts">
  import { X, Search } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import VirtualScroll from '$lib/ui/virtual/VirtualScroll.svelte';

  let { visible, onclose }: { visible: boolean; onclose: () => void } = $props();

  const reader = getReaderContext();
  const { state: manga, goToPage } = reader;

  let query = $state('');
  let searchEl: HTMLInputElement | null = $state(null);

  const pageUrls = $derived(manga.pageUrls);
  const totalPages = $derived(pageUrls.length);
  const chapterName = $derived(manga.selectedChapter ?? '');

  const filteredIndices = $derived.by(() => {
    const q = query.trim();
    if (!q) return pageUrls.map((_, i) => i);
    return pageUrls.map((_, i) => i).filter((i) => String(i + 1).includes(q));
  });

  $effect(() => {
    if (visible) {
      query = '';
      requestAnimationFrame(() => searchEl?.focus());
    }
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

{#if visible}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    style="background: rgba(0,0,0,0.6); padding-bottom: calc(1rem + var(--safe-bottom, 0px))"
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
    >
      <!-- Header -->
      <div class="flex shrink-0 items-center gap-3 border-b border-border/10 px-4 py-3">
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-xs font-bold tracking-widest opacity-50">JUMP TO PAGE</span>
          {#if chapterName}
            <span class="truncate text-xs opacity-40">{chapterName}</span>
          {/if}
        </div>
        <button class="shrink-0 cursor-pointer p-1 opacity-60 hover:opacity-100" onclick={onclose}>
          <X size={16} />
        </button>
      </div>

      <!-- Search bar -->
      <div class="flex shrink-0 items-center gap-3 border-b border-border/10 px-4 py-3">
        <Search size={14} class="shrink-0 opacity-50" />
        <input
          bind:this={searchEl}
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
        <VirtualScroll items={filteredIndices} minItemWidth={100} gap={8} class="flex-1 p-3">
          {#snippet item(i)}
            {@const url = pageUrls[i]}
            {@const isCurrent = i === manga.currentPage}
            <button
              class="group flex cursor-pointer flex-col gap-1"
              onclick={() => pick(i)}
              aria-label="Go to page {i + 1}"
              aria-current={isCurrent ? 'true' : undefined}
            >
              <div
                class="aspect-[2/3] w-full overflow-hidden border-2 transition-colors
                  {isCurrent ? 'border-fg' : 'border-border/10 group-hover:border-fg/40'}"
              >
                {#if url}
                  <img src={url} alt="Page {i + 1}" class="h-full w-full object-cover object-top" />
                {:else}
                  <div class="flex h-full w-full items-center justify-center opacity-20">
                    <span class="text-xs">{i + 1}</span>
                  </div>
                {/if}
              </div>
              <span
                class="text-center text-xs tabular-nums transition-opacity
                  {isCurrent ? 'opacity-100' : 'opacity-50 group-hover:opacity-60'}"
              >
                {i + 1}
              </span>
            </button>
          {/snippet}
        </VirtualScroll>
      {/if}
    </div>
  </div>
{/if}
