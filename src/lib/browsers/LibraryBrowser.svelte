<script lang="ts">
  import type { LibraryEntry, ServerChapter } from '$lib/utils/types';
  import { getReaderContext } from '$lib/context';
  import { ServerLibraryProvider } from '$lib/sources';
  import { apiUrl, getServerUrl } from '$lib/utils/constants';
  import { saveManga } from '$lib/sources/download.svelte';
  import { listOfflineManga } from '$lib/sources/offline-db';
  import { isNative } from '$lib/utils/platform';
  import { BookOpen, FileArchive, Download, Check } from 'lucide-svelte';
  import { showError } from '$lib/ui/toast.svelte';
  import Loader from '$lib/ui/Loader.svelte';

  const { setSource, events } = getReaderContext();

  let entries: LibraryEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let downloadedSlugs: Set<string> = $state.raw(new Set());

  function refreshDownloadedSlugs() {
    listOfflineManga().then((list) => {
      downloadedSlugs = new Set(list.map((m) => m.slug));
    });
  }

  $effect(() => {
    refreshDownloadedSlugs();
    const unsub = events.on('download:complete', () => refreshDownloadedSlugs());
    return unsub;
  });

  $effect(() => {
    if (isNative() && !getServerUrl()) {
      loading = false;
      return;
    }
    const url = apiUrl('/api/library');
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: LibraryEntry[]) => {
        entries = data;
        loading = false;
      })
      .catch((e) => {
        error = `Could not connect to library (${url}: ${e.message})`;
        loading = false;
      });
  });

  const open = (entry: LibraryEntry) => {
    setSource(new ServerLibraryProvider(entry.slug, entry.name));
  };

  async function startDownload(e: MouseEvent, entry: LibraryEntry) {
    e.stopPropagation();
    const res = await fetch(apiUrl(`/api/library/${entry.slug}/chapters`));
    if (!res.ok) {
      showError(`Failed to fetch chapters for "${entry.name}"`);
      return;
    }
    const chapters: ServerChapter[] = await res.json();
    saveManga(entry.slug, entry.name, chapters, events);
  }
</script>

{#if loading}
  <Loader />
{:else if error}
  <p class="text-sm opacity-60">{error}</p>
{:else if entries.length > 0}
  <div class="w-full min-w-0 space-y-1">
    <h2 class="mb-3 text-sm font-bold tracking-widest opacity-60">LIBRARY</h2>
    {#each entries as entry (entry.slug)}
      <div class="flex w-full items-center gap-2 border-2 px-3 py-2">
        <button
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm hover:opacity-80"
          onclick={() => open(entry)}
        >
          {#if entry.type === 'zip'}
            <FileArchive size={16} class="shrink-0 opacity-40" />
          {:else}
            <BookOpen size={16} class="shrink-0 opacity-40" />
          {/if}
          <span class="truncate">{entry.name}</span>
        </button>
        {#if downloadedSlugs.has(entry.slug)}
          <span class="shrink-0 p-1 opacity-30" aria-label="{entry.name} downloaded">
            <Check size={14} />
          </span>
        {/if}
        <button
          class="shrink-0 p-1 opacity-30 hover:opacity-100"
          onclick={(e) => startDownload(e, entry)}
          aria-label="Download {entry.name}"
        >
          <Download size={14} />
        </button>
      </div>
    {/each}
  </div>
{/if}
