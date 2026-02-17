<script lang="ts">
  import { manga, getChapterUrls } from '$lib/state.svelte';
  import { resolveKey } from '$lib/keybindings.svelte';
  import { intersect } from '$lib/actions/intersect';
  import Loader from '$lib/ui/Loader.svelte';

  let container: HTMLDivElement;
  let pageRefs: HTMLDivElement[] = $state([]);

  let pageUrls: string[] = $state([]);
  let loading = $state(false);

  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    let cancelled = false;
    let revoke = false;
    let urls: string[] = [];
    loading = true;
    pageUrls = [];

    getChapterUrls(chapter).then((result) => {
      if (cancelled) return;
      urls = result.urls;
      revoke = result.revoke;
      pageUrls = urls;
      loading = false;
      manga.shouldScroll = true;
    });

    return () => {
      cancelled = true;
      if (revoke) urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  // when shouldscroll is set (sidebar page click or progress restore), scroll to that page
  $effect(() => {
    if (!manga.shouldScroll) return;
    manga.shouldScroll = false;
    const idx = manga.currentPage;
    const target = pageRefs[idx];
    if (!target) return;

    // Wait for images up to target to load so their heights are established
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

  const scrollNext = () => {
    if (manga.currentPage < pageUrls.length - 1) {
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

  const handleKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const action = resolveKey(event.key);
    if (action === 'nextPage') {
      event.preventDefault();
      scrollNext();
    } else if (action === 'prevPage') {
      event.preventDefault();
      scrollPrev();
    } else if (action === 'nextPageRTL') {
      event.preventDefault();
      if (manga.rtl) scrollPrev();
      else scrollNext();
    } else if (action === 'prevPageRTL') {
      event.preventDefault();
      if (manga.rtl) scrollNext();
      else scrollPrev();
    }
  };
</script>

<svelte:window onkeydown={handleKey} />

<div
  bind:this={container}
  class="flex h-full flex-1 flex-col gap-2 overflow-y-auto py-4 select-none"
>
  {#if loading}
    <Loader />
  {:else}
    {#each pageUrls as src, i (src)}
      <div
        bind:this={pageRefs[i]}
        class="flex w-full justify-center"
        use:intersect={(visible) => {
          if (visible) manga.currentPage = i;
        }}
      >
        <img
          {src}
          alt="Page {i + 1} of {pageUrls.length}"
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
