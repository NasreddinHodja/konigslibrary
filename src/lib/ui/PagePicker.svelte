<script lang="ts">
  import Icon from './Icon.svelte';
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
  class="fixed inset-0 z-50 flex items-center justify-center checker p-4"
  style="padding-bottom: calc(1rem + var(--safe-bottom, 0px))"
  role="presentation"
  onclick={onclose}
>
  <!-- Modal -->
  <div
    class="flex h-full max-h-[85vh] w-full max-w-2xl flex-col panel"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Jump to page"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKeydown}
    {@attach focusTrap}
  >
    <!-- Header -->
    <div class="flex shrink-0 items-center gap-3 border-b border-ink px-3 py-2">
      <div class="flex min-w-0 flex-1 flex-col">
        <span>jump to page</span>
        {#if chapterName}
          <span class="truncate text-dim">{chapterName}</span>
        {/if}
      </div>
      <button
        class="hit relative flex shrink-0 cursor-pointer items-center justify-center text-ink hover:text-hi"
        onclick={onclose}
        aria-label="Close"
      >
        <Icon name="close" />
      </button>
    </div>

    <!-- Search bar -->
    <div class="flex shrink-0 items-center gap-3 border-b border-ink px-3 py-2">
      <input
        {@attach (el) => {
          // After the dialog's focus trap has focused its first button.
          requestAnimationFrame(() => el.focus());
        }}
        bind:value={query}
        type="text"
        inputmode="numeric"
        placeholder="Page number…"
        class="h-8 min-w-0 flex-1 border border-ink bg-bg px-2 placeholder:text-dim pointer-coarse:h-10"
      />
      <span class="shrink-0 text-dim tabular-nums">{totalPages} pages</span>
    </div>

    <!-- Grid -->
    {#if filteredIndices.length === 0}
      <p class="flex-1 py-12 text-center text-dim">No pages match</p>
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
                  <div class="flex h-full w-full items-center justify-center text-dim">
                    <span>{i + 1}</span>
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
