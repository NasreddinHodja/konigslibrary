<script lang="ts">
  import type { LibraryEntry, ServerChapter } from '$lib/utils/types';
  import { getReaderContext } from '$lib/context';
  import { ServerLibraryProvider } from '$lib/sources';
  import { apiUrl } from '$lib/utils/constants';
  import { saveManga } from '$lib/sources/download.svelte';
  import { listOfflineManga } from '$lib/sources/offline-idb';
  import { showError } from '$lib/ui/toast.svelte';
  import { Download } from 'lucide-svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import MangaList from './MangaList.svelte';

  const { setSource, events } = getReaderContext();

  let entries: LibraryEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let downloadedSlugs: Set<string> = $state.raw(new Set());
  let downloadingSlug: string | null = $state(null);
  let pendingDownload: LibraryEntry | null = $state(null);

  const listEntries = $derived(
    entries.filter((e) => !downloadedSlugs.has(e.slug)).map((e) => ({ id: e.slug, name: e.name }))
  );

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

  async function open(slug: string) {
    const entry = entries.find((e) => e.slug === slug)!;
    try {
      await setSource(new ServerLibraryProvider(entry.slug, entry.name));
    } catch (err) {
      showError(`Failed to open "${entry.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

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

  function requestDownload(slug: string) {
    pendingDownload = entries.find((e) => e.slug === slug) ?? null;
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

<MangaList
  title="LIBRARY"
  entries={listEntries}
  {loading}
  {error}
  onopen={open}
  action={{ icon: Download, label: 'Download', onclick: requestDownload, loadingId: downloadingSlug }}
/>
