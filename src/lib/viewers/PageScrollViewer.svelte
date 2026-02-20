<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter } from '$lib/pipeline';
  import { intersect } from '$lib/actions/intersect';
  import Loader from '$lib/ui/Loader.svelte';

  let { commands = $bindable() }: { commands?: ViewerCommands | null } = $props();

  const svc = getReaderContext();
  const { state: manga } = svc;

  const chapter = useChapter(svc);

  let pageRefs: HTMLDivElement[] = $state([]);

  // When shouldScroll is set (sidebar page click or progress restore), scroll to that page
  $effect(() => {
    if (!manga.shouldScroll) return;
    manga.shouldScroll = false;
    const idx = manga.currentPage;
    const target = pageRefs[idx];
    if (!target) return;

    const pending = pageRefs
      .slice(0, idx + 1)
      .map((d) => d?.querySelector('img'))
      .filter((img): img is HTMLImageElement => !!img && !img.complete);

    if (pending.length === 0) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((r) => {
            img.addEventListener('load', () => r(), { once: true });
            img.addEventListener('error', () => r(), { once: true });
          })
      )
    ).then(() => target.scrollIntoView({ block: 'center' }));
  });

  // Set shouldScroll after chapter loads so scroll position restores
  $effect(() => {
    if (!chapter.loading && chapter.pageUrls.length > 0) {
      manga.shouldScroll = true;
    }
  });

  const scrollNext = () => {
    if (manga.currentPage < chapter.pageUrls.length - 1) {
      manga.currentPage++;
      pageRefs[manga.currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const scrollPrev = () => {
    if (manga.currentPage > 0) {
      manga.currentPage--;
      pageRefs[manga.currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  commands = { nextPage: scrollNext, prevPage: scrollPrev };
</script>

<div class="flex h-full flex-1 flex-col gap-2 overflow-y-auto py-4 select-none">
  {#if chapter.loading}
    <Loader />
  {:else}
    {#each chapter.pageUrls as src, i (src)}
      <div
        bind:this={pageRefs[i]}
        class="flex w-full justify-center"
        use:intersect={(visible) => {
          if (visible) manga.currentPage = i;
        }}
      >
        <img
          {src}
          alt="Page {i + 1} of {chapter.pageUrls.length}"
          loading="lazy"
          class="mx-auto"
          style="width: {manga.zoom * 100}%"
          onerror={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            img.style.display = 'none';
            img.insertAdjacentHTML(
              'afterend',
              '<p class="py-8 text-sm opacity-40">Failed to load page</p>'
            );
          }}
        />
      </div>
    {/each}
  {/if}
</div>
