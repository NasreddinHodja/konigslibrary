<script lang="ts">
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { SvelteMap } from 'svelte/reactivity';
  import { getReaderContext } from '$lib/context';
  import {
    ZipUploadProvider,
    NativeFilesystemProvider,
    LocalFsProvider,
    ServerLibraryProvider
  } from '$lib/sources';
  import { listNativeManga, listNativeChapters, getMangaDir } from '$lib/sources/native-library';
  import { saveManga } from '$lib/sources/download.svelte';
  import type { LibraryEntry, ServerChapter } from '$lib/utils/types';
  import { apiUrl, isLocalServer, getServerUrl } from '$lib/utils/constants';
  import { isNative } from '$lib/utils/platform';
  import { showError, addToast, updateToast } from '$lib/ui/toast.svelte';
  import { describeOpenFileError } from '$lib/utils/errors';
  import { Download, Trash2, RefreshCw, LibraryBig, Search, X } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import MangaCard from './MangaCard.svelte';

  type Row = {
    id: string;
    name: string;
    device?: { path: string; type: 'directory' | 'zip' };
    server?: { slug: string };
    downloaded: boolean;
  };

  type Filter = 'all' | 'downloaded' | 'device' | 'server';

  const { setSource, events } = getReaderContext();
  const native = isNative();
  const mangaDir = native ? getMangaDir() : '';
  const serverEnabled = isLocalServer || !!getServerUrl();

  let deviceEntries: { name: string; type: 'directory' | 'zip'; path: string }[] = $state([]);
  let deviceLoading = $state(!!mangaDir);
  let deviceError: string | null = $state(null);

  let serverEntries: LibraryEntry[] = $state([]);
  let serverLoading = $state(serverEnabled);

  let downloadedEntries: { slug: string; name: string }[] = $state([]);

  let selectedFilter: Filter = $state('all');
  let searchQuery = $state('');
  let downloadingSlug: string | null = $state(null);
  let pendingDelete: { slug: string; name: string } | null = $state(null);
  let pendingDownload: { slug: string; name: string } | null = $state(null);

  async function loadDevice() {
    if (!mangaDir) return;
    deviceLoading = true;
    deviceError = null;
    try {
      deviceEntries = await listNativeManga();
    } catch {
      deviceError = `Could not read manga directory: ${mangaDir}`;
    }
    deviceLoading = false;
  }

  function loadServer() {
    if (!serverEnabled) return;
    serverLoading = true;
    const url = apiUrl('/api/library');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: LibraryEntry[]) => {
        serverEntries = data;
        serverLoading = false;
      })
      .catch(() => {
        serverLoading = false;
      })
      .finally(() => clearTimeout(timer));
  }

  function loadDownloaded() {
    if (!native) return;
    invoke<{ slug: string; name: string }[]>('list_offline_manga').then((list) => {
      downloadedEntries = list;
    });
  }

  $effect(() => {
    loadDevice();
    loadServer();
    loadDownloaded();
    const unsubComplete = events.on('download:complete', () => loadDownloaded());
    const unsubDeleted = events.on('download:deleted', () => loadDownloaded());
    return () => {
      unsubComplete();
      unsubDeleted();
    };
  });

  const rows = $derived.by(() => {
    const map = new SvelteMap<string, Row>();
    for (const e of deviceEntries) {
      const id = `device:${e.path}`;
      map.set(id, { id, name: e.name, device: { path: e.path, type: e.type }, downloaded: false });
    }
    for (const e of serverEntries) {
      map.set(e.slug, { id: e.slug, name: e.name, server: { slug: e.slug }, downloaded: false });
    }
    for (const d of downloadedEntries) {
      const existing = map.get(d.slug);
      if (existing) {
        existing.downloaded = true;
      } else {
        map.set(d.slug, { id: d.slug, name: d.name, downloaded: true });
      }
    }
    return Array.from(map.values());
  });

  const hasDevice = $derived(rows.some((r) => r.device));
  const hasServer = $derived(rows.some((r) => r.server || r.downloaded));
  const hasDownloaded = $derived(rows.some((r) => r.downloaded));
  const hasUndownloadedServer = $derived(rows.some((r) => r.server && !r.downloaded));
  const multiProvider = $derived(hasDevice && hasServer);

  const chips = $derived.by(() => {
    const list: { key: Filter; label: string }[] = [];
    if (multiProvider) list.push({ key: 'all', label: 'All' });
    if (hasDownloaded && hasUndownloadedServer)
      list.push({ key: 'downloaded', label: 'Downloaded' });
    if (multiProvider) {
      list.push({ key: 'device', label: 'Device' });
      list.push({ key: 'server', label: 'Server' });
    }
    return list;
  });

  const filter = $derived.by(() => {
    if (chips.length === 0 || selectedFilter === 'all') return 'all';
    if (chips.some((c) => c.key === selectedFilter)) return selectedFilter;
    return chips[0].key;
  });

  const filteredRows = $derived.by(() => {
    let list = rows;
    if (filter === 'downloaded') list = list.filter((r) => r.downloaded);
    else if (filter === 'device') list = list.filter((r) => r.device);
    else if (filter === 'server') list = list.filter((r) => r.server || r.downloaded);

    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));

    return [...list].sort((a, b) => {
      if (filter === 'all' && a.downloaded !== b.downloaded) return a.downloaded ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  });

  const loading = $derived(deviceLoading || serverLoading);
  const errors = $derived(deviceError ? [deviceError] : []);

  function rowAction(row: Row) {
    if (!native || !row.server) return null;
    if (row.downloaded) {
      return {
        icon: Trash2,
        label: 'Delete',
        loading: false,
        onclick: () => (pendingDelete = { slug: row.server!.slug, name: row.name })
      };
    }
    return {
      icon: Download,
      label: 'Download',
      loading: downloadingSlug === row.server.slug,
      onclick: () => (pendingDownload = { slug: row.server!.slug, name: row.name })
    };
  }

  async function openRow(row: Row) {
    try {
      if (row.device) {
        if (row.device.type === 'zip') {
          const url = convertFileSrc(row.device.path);
          const response = await fetch(url);
          const blob = await response.blob();
          const file = new File([blob], row.name + '.cbz', { type: 'application/zip' });
          await setSource(new ZipUploadProvider(file));
        } else {
          const chapters = await listNativeChapters(row.device.path);
          await setSource(new NativeFilesystemProvider(chapters, row.name));
        }
        return;
      }

      const slug = row.server?.slug ?? row.id;
      if (row.downloaded) {
        await setSource(new LocalFsProvider(slug, row.name));
      } else {
        await setSource(new ServerLibraryProvider(slug, row.name));
      }
    } catch (err) {
      showError(describeOpenFileError(err));
    }
  }

  async function confirmDownload() {
    if (!pendingDownload) return;
    const { slug, name } = pendingDownload;
    pendingDownload = null;
    downloadingSlug = slug;
    try {
      const res = await fetch(apiUrl(`/api/library/${slug}/chapters`));
      if (!res.ok) {
        showError(`Failed to fetch chapters for "${name}"`);
        return;
      }
      const chapters: ServerChapter[] = await res.json();
      saveManga(slug, name, chapters, events);
    } catch {
      showError(`Could not reach server to download "${name}"`);
    } finally {
      downloadingSlug = null;
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { slug, name } = pendingDelete;
    pendingDelete = null;

    const id = `del-${Date.now()}`;
    addToast({ id, label: name, current: 0, total: 0, phase: 'deleting' });

    try {
      await invoke('delete_offline_manga', { slug });
      events.emit('download:deleted', { slug });
      updateToast(id, { phase: 'done' });
    } catch (err) {
      updateToast(id, {
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }

  function refresh() {
    loadDevice();
    loadServer();
    loadDownloaded();
  }
</script>

{#if pendingDownload}
  <ConfirmDialog
    message={`Download "${pendingDownload.name}"? This may take a while depending on size.`}
    confirmLabel="Download"
    onconfirm={confirmDownload}
    oncancel={() => (pendingDownload = null)}
  />
{/if}

{#if pendingDelete}
  <ConfirmDialog
    message={`Delete "${pendingDelete.name}"? This will remove all downloaded pages.`}
    confirmLabel="Delete"
    onconfirm={confirmDelete}
    oncancel={() => (pendingDelete = null)}
  />
{/if}

<div class="w-full min-w-0 border-2 border-border/15">
  {#if mangaDir || serverEnabled || rows.length > 0}
    <div
      class="flex flex-col gap-3 border-b border-border/15 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
    >
      <div class="flex shrink-0 items-center justify-between gap-3">
        <span class="text-xs font-bold tracking-widest opacity-50">
          LIBRARY ({rows.length})
        </span>
        <button
          class="cursor-pointer p-1.5 opacity-40 hover:bg-fg/10 hover:opacity-90 sm:hidden"
          onclick={refresh}
          aria-label="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div
        class="flex min-w-0 flex-1 items-center gap-2 border-2 border-border/15 px-3 py-1.5 focus-within:border-fg/50"
      >
        <Search size={12} class="shrink-0 opacity-50" />
        <input
          type="text"
          placeholder="Search library"
          bind:value={searchQuery}
          class="w-full min-w-0 bg-transparent text-sm outline-none placeholder:opacity-50"
        />
        {#if searchQuery}
          <button
            class="cursor-pointer opacity-50 hover:opacity-80"
            onclick={() => (searchQuery = '')}
          >
            <X size={12} />
          </button>
        {/if}
      </div>

      <div class="flex shrink-0 items-center gap-2 overflow-x-auto">
        {#each chips as chip (chip.key)}
          <button
            class="cursor-pointer border-2 px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap {filter ===
            chip.key
              ? 'border-fg bg-fg text-bg'
              : 'border-border/20 opacity-60 hover:border-border/50 hover:opacity-100'}"
            onclick={() => (selectedFilter = filter === chip.key ? 'all' : chip.key)}
          >
            {chip.label}
          </button>
        {/each}
        <button
          class="hidden cursor-pointer p-1.5 opacity-40 hover:bg-fg/10 hover:opacity-90 sm:inline-flex"
          onclick={refresh}
          aria-label="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  {/if}

  <div class="p-4">
    {#each errors as err (err)}
      <p class="mb-2 text-xs opacity-60">{err}</p>
    {/each}

    {#if loading}
      <div
        class="grid grid-cols-3 gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] md:gap-x-4 md:gap-y-6"
      >
        {#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}
          <div class="flex flex-col gap-1.5">
            <Skeleton class="aspect-[2/3] w-full" />
            <Skeleton class="h-3 w-4/5" />
          </div>
        {/each}
      </div>
    {:else if filteredRows.length > 0}
      <div
        class="grid grid-cols-3 gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] md:gap-x-4 md:gap-y-6"
      >
        {#each filteredRows as row (row.id)}
          {@const action = rowAction(row)}
          <MangaCard
            name={row.name}
            badge={row.device ? 'device' : row.downloaded ? 'downloaded' : 'server'}
            {action}
            onopen={() => openRow(row)}
          />
        {/each}
      </div>
    {:else if errors.length === 0}
      <div class="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
        <LibraryBig size={22} class="opacity-25" />
        <p class="text-xs opacity-60">
          {#if !mangaDir && !serverEnabled}
            No manga sources configured - <a href="/settings" class="underline"
              >set one up in Settings</a
            >
          {:else if searchQuery.trim()}
            No results for "{searchQuery.trim()}"
          {:else}
            No manga found
          {/if}
        </p>
      </div>
    {/if}
  </div>
</div>
