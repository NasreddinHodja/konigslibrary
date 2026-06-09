<script lang="ts">
  import type { LibraryEntry, ServerChapter } from '$lib/utils/types';
  import { getReaderContext } from '$lib/context';
  import { ServerLibraryProvider } from '$lib/sources';
  import { apiUrl, getServerUrl } from '$lib/utils/constants';
  import { saveManga } from '$lib/sources/download.svelte';
  import { listOfflineManga } from '$lib/sources/offline-db';
  import { isNative } from '$lib/utils/platform';
  import { Download, Check } from 'lucide-svelte';
  import { showError } from '$lib/ui/toast.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';

  const { setSource, events } = getReaderContext();

  let entries: LibraryEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let downloadedSlugs: Set<string> = $state.raw(new Set());
  let downloadingSlug: string | null = $state(null);
  let pendingDownload: LibraryEntry | null = $state(null);

  function refreshDownloadedSlugs() {
    listOfflineManga().then((list) => {
      downloadedSlugs = new Set(list.map((m) => m.slug));
    });
  }

  $effect(() => {
    refreshDownloadedSlugs();
    const unsubComplete = events.on('download:complete', () => refreshDownloadedSlugs());
    const unsubDeleted = events.on('download:deleted', () => refreshDownloadedSlugs());
    return () => {
      unsubComplete();
      unsubDeleted();
    };
  });

  $effect(() => {
    if (isNative() && !getServerUrl()) {
      loading = false;
      return;
    }
    const url = apiUrl('/api/library');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: LibraryEntry[]) => {
        entries = data;
        loading = false;
      })
      .catch((e) => {
        const msg = e.name === 'AbortError' ? 'timed out' : e.message;
        error = `Could not connect to library (${url}: ${msg})`;
        loading = false;
      })
      .finally(() => clearTimeout(timer));
  });

  const open = async (entry: LibraryEntry) => {
    try {
      await setSource(new ServerLibraryProvider(entry.slug, entry.name));
    } catch (err) {
      showError(`Failed to open "${entry.name}": ${err instanceof Error ? err.message : err}`);
    }
  };

  async function startDownload(entry: LibraryEntry) {
    if (downloadingSlug === entry.slug) return;
    downloadingSlug = entry.slug;
    try {
      const res = await fetch(apiUrl(`/api/library/${entry.slug}/chapters`));
      if (!res.ok) {
        showError(`Failed to fetch chapters for "${entry.name}"`);
        return;
      }
      const chapters: ServerChapter[] = await res.json();
      saveManga(entry.slug, entry.name, chapters, events);
    } catch {
      showError(`Could not reach server to download "${entry.name}"`);
    } finally {
      downloadingSlug = null;
    }
  }

  function requestDownload(e: MouseEvent, entry: LibraryEntry) {
    e.stopPropagation();
    pendingDownload = entry;
  }
</script>

{#if pendingDownload}
  <ConfirmDialog
    message={`Download "${pendingDownload.name}"? This may take a while depending on size.`}
    confirmLabel="Download"
    onconfirm={() => {
      const entry = pendingDownload!;
      pendingDownload = null;
      startDownload(entry);
    }}
    oncancel={() => (pendingDownload = null)}
  />
{/if}

{#if loading}
  <div class="w-full min-w-0">
    <Skeleton class="mb-2 h-3.5 w-14" />
    <div class="border-2">
      {#each [180, 140, 210, 160] as w (w)}
        <div class="flex items-center border-b border-fg/10 px-4 py-3 last:border-b-0">
          <Skeleton class="h-5" style="width: {w}px" />
        </div>
      {/each}
    </div>
  </div>
{:else if error}
  <p class="text-xs opacity-40">{error}</p>
{:else if entries.length > 0}
  <div class="w-full min-w-0">
    <p class="mb-2 text-xs font-bold tracking-widest opacity-30">LIBRARY</p>
    <div class="border-2">
      {#each entries as entry (entry.slug)}
        <div class="flex items-center border-b border-fg/10 last:border-b-0">
          <button
            class="flex min-w-0 flex-1 cursor-pointer px-4 py-3 text-left text-sm hover:bg-fg/10"
            onclick={() => open(entry)}
          >
            <span class="truncate">{entry.name}</span>
          </button>
          {#if downloadedSlugs.has(entry.slug)}
            <span class="shrink-0 px-3 py-3 opacity-30" aria-label="{entry.name} downloaded">
              <Check size={14} />
            </span>
          {:else}
            <button
              class="shrink-0 px-3 py-3 {downloadingSlug === entry.slug
                ? 'animate-pulse cursor-wait opacity-50'
                : 'cursor-pointer opacity-20 hover:opacity-80'}"
              onclick={(e) => requestDownload(e, entry)}
              disabled={downloadingSlug === entry.slug}
              aria-label="Download {entry.name}"
            >
              <Download size={14} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
