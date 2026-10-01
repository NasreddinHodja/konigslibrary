<script lang="ts">
  import { invoke, Channel } from '@tauri-apps/api/core';
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { getReaderContext } from '$lib/context';
  import { NativeFilesystemProvider, ServerLibraryProvider } from '$lib/sources';
  import { fetchLibraryPage } from '$lib/sources/library';
  import {
    listDeviceManga,
    listNativeChapters,
    getMangaDir,
    type Origin
  } from '$lib/sources/native-library';
  import { fetchNativeMeta, fetchServerMeta, serverCoverUrl, type CardMeta } from '$lib/api/meta';
  import { saveManga } from '$lib/sources/download.svelte';
  import {
    serverStatus,
    watchServer,
    checkServer,
    reportServerFailure
  } from '$lib/sources/connection.svelte';
  import type { ServerChapter } from '$lib/utils/types';
  import { apiUrl, isLocalServer, getServerUrl } from '$lib/utils/constants';
  import { isNative } from '$lib/utils/platform';
  import { showError, addToast, updateToast } from '$lib/ui/toast.svelte';
  import { describeOpenFileError } from '$lib/utils/errors';
  import { Download, Trash2, RefreshCw, LibraryBig } from 'lucide-svelte';
  import ListPanel from '$lib/ui/ListPanel.svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import MangaCard from './MangaCard.svelte';
  import LoadMore from './LoadMore.svelte';
  import { forgetMeta, rememberMeta } from './cover-queue';

  type Tab = 'device' | 'server';

  type Row = {
    id: string;
    name: string;
    /// Where the manga is on this device; null for a row of the Server tab.
    path: string | null;
    /// Server slug, for a server manga or a downloaded one.
    slug: string | null;
    /// Where a Device-tab manga came from; null for a row of the Server tab.
    origin: Origin | null;
    /// Title and cover the server already listed, sparing a request per card.
    known: CardMeta | null;
  };

  type List = { rows: Row[]; next: string | null; loading: boolean; loaded: boolean };

  const SERVER_TIMEOUT = 8000;
  const SEARCH_DEBOUNCE = 250;

  const { setSource, events } = getReaderContext();
  const native = isNative();
  const mangaDir = native ? getMangaDir() : '';
  const serverEnabled = isLocalServer || !!getServerUrl();

  const emptyList = (): List => ({ rows: [], next: null, loading: false, loaded: false });
  const lists: Record<Tab, List> = $state({ device: emptyList(), server: emptyList() });
  // Bumped when a list is reset, so pages still in flight for it are dropped.
  const generation: Record<Tab, number> = { device: 0, server: 0 };
  let deviceError: string | null = $state(null);

  /// Downloaded manga: server slug to the folder holding the copy.
  const downloads = new SvelteMap<string, string>();

  const LS_TAB = 'kl:libraryTab';
  // The last tab picked, kept across launches.
  let selectedTab: Tab | null = $state(localStorage.getItem(LS_TAB) as Tab | null);
  function selectTab(t: Tab) {
    selectedTab = t;
    localStorage.setItem(LS_TAB, t);
  }
  let searchQuery = $state('');
  let query = $state('');
  let downloadingSlug: string | null = $state(null);
  let refreshing = $state(false);
  // Metadata titles, reported by the cards as they load.
  const titles = new SvelteMap<string, string>();
  const displayName = (row: Row) => titles.get(row.id) ?? row.name;

  // A download is deleted by its server slug, an import by its folder name.
  let pendingDelete: { slug: string; name: string } | { folder: string; name: string } | null =
    $state(null);
  let pendingDownload: { slug: string; name: string } | null = $state(null);

  const tabs = $derived.by(() => {
    const list: Tab[] = [];
    if (native) list.push('device');
    if (serverEnabled) list.push('server');
    return list;
  });
  const tab = $derived(selectedTab && tabs.includes(selectedTab) ? selectedTab : (tabs[0] ?? null));
  /// Skeletons until a tab's first page lands, unless it never will: the
  /// server is known to be down.
  function isLoading(t: Tab): boolean {
    const list = lists[t];
    return (
      list.rows.length === 0 &&
      (list.loading || (!list.loaded && !(t === 'server' && serverStatus() === 'offline')))
    );
  }

  function reset(which: Tab) {
    generation[which]++;
    lists[which] = emptyList();
    if (which === 'device') deviceError = null;
  }

  async function fetchPage(which: Tab, q: string, after: string | null) {
    if (which === 'device') {
      const page = await listDeviceManga(q, after);
      const rows: Row[] = page.entries.map((e) => ({
        id: `device:${e.path}`,
        name: e.name,
        path: e.path,
        slug: e.slug,
        origin: e.origin,
        known: null
      }));
      return { rows, next: page.next };
    }
    const page = await fetchLibraryPage(q, after, AbortSignal.timeout(SERVER_TIMEOUT));
    const rows: Row[] = page.entries.map((e) => ({
      id: `server:${e.slug}`,
      name: e.name,
      path: null,
      slug: e.slug,
      origin: null,
      known: e.scanned
        ? {
            title: e.title ?? null,
            coverUrl: e.cover ? serverCoverUrl(e.slug, e.cover, e.coverVersion) : null
          }
        : null
    }));
    // Cards then mount with the server's title and cover already in hand.
    for (const row of rows) if (row.known) rememberMeta(`server:${row.slug}`, row.known);
    return { rows, next: page.next };
  }

  async function loadMore(which: Tab) {
    const list = lists[which];
    if (list.loading || (list.loaded && list.next === null)) return;
    if (which === 'server' && serverStatus() !== 'online') return;
    const gen = generation[which];
    list.loading = true;
    try {
      const page = await fetchPage(which, query, list.next);
      if (gen !== generation[which]) return;
      list.rows.push(...page.rows);
      list.next = page.next;
    } catch {
      if (gen !== generation[which]) return;
      list.next = null;
      if (which === 'server') reportServerFailure();
      else deviceError = `Could not read manga directory: ${mangaDir}`;
    } finally {
      if (gen === generation[which]) {
        list.loading = false;
        list.loaded = true;
      }
    }
  }

  function loadDownloads() {
    if (!native) return;
    return invoke<{ slug: string; path: string }[]>('list_offline_manga').then((list) => {
      downloads.clear();
      for (const d of list) downloads.set(d.slug, d.path);
    });
  }

  $effect(() => {
    loadDownloads();
    const unwatch = serverEnabled ? watchServer() : () => {};
    // Downloads are listed in the Device tab.
    const onChange = () => {
      loadDownloads();
      reset('device');
    };
    const unsubComplete = events.on('download:complete', onChange);
    const unsubDeleted = events.on('download:deleted', onChange);
    const unsubImported = events.on('import:complete', () => reset('device'));
    return () => {
      unwatch();
      unsubComplete();
      unsubDeleted();
      unsubImported();
    };
  });

  $effect(() => {
    const q = searchQuery.trim();
    const timer = setTimeout(() => (query = q), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  });

  // A new query starts both lists over; only the visible one refetches now.
  $effect(() => {
    void query;
    untrack(() => {
      reset('device');
      reset('server');
    });
  });

  // Offline, the Server tab is emptied rather than kept around greyed out: its
  // manga can't be opened or downloaded, and the server may never come back.
  $effect(() => {
    if (!serverEnabled) return;
    const s = serverStatus();
    untrack(() => {
      if (s !== 'online') reset('server');
    });
  });

  // The first page of every tab, the hidden one too: swiping drags it into
  // view, so it should already be filled.
  $effect(() => {
    for (const t of tabs) {
      if (lists[t].loaded || lists[t].loading) continue;
      if (t === 'server' && serverStatus() !== 'online') continue;
      untrack(() => loadMore(t));
    }
  });

  /// The copy on this device, if there is one: a device folder or a download.
  function localPath(row: Row): string | null {
    return row.path ?? (row.slug ? (downloads.get(row.slug) ?? null) : null);
  }

  function badge(row: Row): 'device' | 'downloaded' | 'server' {
    if (row.slug && downloads.has(row.slug)) return 'downloaded';
    return row.path ? 'device' : 'server';
  }

  function rowAction(row: Row) {
    if (!native) return null;
    if (row.origin === 'import') {
      const folder = row.name;
      return {
        icon: Trash2,
        label: 'Delete',
        loading: false,
        onclick: () => (pendingDelete = { folder, name: displayName(row) })
      };
    }
    if (!row.slug) return null;
    const slug = row.slug;
    if (downloads.has(slug)) {
      return {
        icon: Trash2,
        label: 'Delete',
        loading: false,
        onclick: () => (pendingDelete = { slug, name: displayName(row) })
      };
    }
    if (row.path) return null;
    return {
      icon: Download,
      label: 'Download',
      loading: downloadingSlug === slug,
      onclick: () => (pendingDownload = { slug, name: displayName(row) })
    };
  }

  /// A local copy's metadata is read from it, so it is keyed apart from the
  /// server's.
  function metaKey(row: Row): string {
    const path = localPath(row);
    return path ? `path:${path}` : `server:${row.slug}`;
  }

  function metaLoader(row: Row): () => Promise<CardMeta | null> {
    const path = localPath(row);
    if (path) return () => fetchNativeMeta(path);
    const known = row.known;
    if (known) return async () => known;
    const slug = row.slug;
    if (slug) return () => fetchServerMeta(slug);
    return async () => null;
  }

  async function openRow(row: Row) {
    try {
      const path = localPath(row);
      if (path) {
        const chapters = await listNativeChapters(path);
        await setSource(new NativeFilesystemProvider(chapters, row.name, path));
      } else if (row.slug) {
        await setSource(new ServerLibraryProvider(row.slug, row.name));
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
      reportServerFailure();
    } finally {
      downloadingSlug = null;
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const { name } = target;
    pendingDelete = null;

    const id = `del-${Date.now()}`;
    addToast({ id, label: name, current: 0, total: 0, phase: 'deleting' });

    try {
      const channel = new Channel<{ current: number; total: number }>();
      channel.onmessage = ({ current, total }) => updateToast(id, { current, total });
      if ('slug' in target) {
        await invoke('delete_offline_manga', { slug: target.slug, channel });
        events.emit('download:deleted', { slug: target.slug });
      } else {
        await invoke('delete_imported_manga', { name: target.folder, channel });
        reset('device');
      }
      updateToast(id, { phase: 'done' });
    } catch (err) {
      updateToast(id, {
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    forgetMeta();
    // Emptied lists refetch through the effect once the server check settles.
    reset('device');
    reset('server');
    // Local loads finish in milliseconds; the floor keeps the spin visible.
    try {
      await Promise.all([
        loadDownloads(),
        serverEnabled ? checkServer() : null,
        new Promise((r) => setTimeout(r, 600))
      ]);
    } finally {
      refreshing = false;
    }
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
    message={`Delete "${pendingDelete.name}"? This will remove all its chapters from this device.`}
    confirmLabel="Delete"
    onconfirm={confirmDelete}
    oncancel={() => (pendingDelete = null)}
  />
{/if}

<!-- The server's connection, shown on what it is about: the SERVER tab, or
     next to the label when the server is the only source. Not a control of its
     own — refresh retries — since it sits inside the tab's button. -->
{#snippet serverDot()}
  {@const status = serverStatus()}
  <span
    class="flex items-center gap-1.5 text-[10px] font-bold tracking-widest"
    title={status === 'online'
      ? 'Server connected'
      : status === 'offline'
        ? 'Server unreachable'
        : 'Checking server'}
  >
    <span
      class="size-2 rounded-full {status === 'online'
        ? 'bg-success'
        : status === 'offline'
          ? 'bg-muted'
          : 'animate-pulse bg-muted'}"
    ></span>
    {#if status === 'offline'}<span class="opacity-60">OFFLINE</span>{/if}
  </span>
{/snippet}

{#snippet refreshButton()}
  <button
    class="flex size-7 cursor-pointer items-center justify-center opacity-40 hover:bg-fg/10 hover:opacity-90"
    onclick={refresh}
    aria-label="Refresh"
  >
    <RefreshCw size={13} class={refreshing ? 'animate-spin' : ''} />
  </button>
{/snippet}

{#snippet body(t: Tab | null)}
  {#if t === 'device' && deviceError}
    <p class="mb-2 text-xs opacity-60">{deviceError}</p>
  {/if}

  {#if t && isLoading(t)}
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
  {:else if t && lists[t].rows.length > 0}
    <div
      class="grid grid-cols-3 gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] md:gap-x-4 md:gap-y-6"
    >
      {#each lists[t].rows as row (row.id)}
        {@const action = rowAction(row)}
        <MangaCard
          name={row.name}
          ontitle={(title) => titles.set(row.id, title)}
          metaKey={metaKey(row)}
          loadMeta={metaLoader(row)}
          badge={badge(row)}
          {action}
          onopen={() => openRow(row)}
        />
      {/each}
    </div>
    <LoadMore onvisible={() => loadMore(t)} watch={lists[t].rows.length} />
  {:else if !deviceError || t !== 'device'}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
      <LibraryBig size={22} class="opacity-25" />
      <p class="text-xs opacity-60">
        {#if tabs.length === 0}
          No manga sources configured - <a href="/settings" class="underline"
            >set one up in Settings</a
          >
        {:else if searchQuery.trim()}
          No results for "{searchQuery.trim()}"
        {:else if t === 'server' && serverStatus() === 'offline'}
          Server unreachable
        {:else if t === 'device' && !mangaDir}
          No manga on this device yet - download some from the server
        {:else}
          No manga found
        {/if}
      </p>
    </div>
  {/if}
{/snippet}

{#if tabs.length > 0}
  <ListPanel
    tabs={tabs.map((t) =>
      t === 'device' ? { key: t, label: 'DEVICE' } : { key: t, label: 'SERVER', badge: serverDot }
    )}
    activeTab={tab}
    ontab={(key) => selectTab(key as Tab)}
    label="LIBRARY"
    status={tabs.length === 1 && serverEnabled ? serverDot : undefined}
    actions={tab === 'device' && !mangaDir ? undefined : refreshButton}
    bind:search={searchQuery}
    placeholder="Search library"
    fill
    pageClass="pb-[calc(5.25rem_+_var(--safe-bottom))] md:pb-8"
  >
    {#snippet children(key)}
      {@render body(key as Tab | null)}
    {/snippet}
  </ListPanel>
{:else}
  <div class="flex flex-1 flex-col p-4">
    {@render body(null)}
  </div>
{/if}
