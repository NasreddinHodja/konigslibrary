<script lang="ts">
  import { Channel } from '@tauri-apps/api/core';
  import { untrack } from 'svelte';
  import type { TransitionConfig } from 'svelte/transition';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { getReaderContext } from '$lib/context';
  import { openNativeManga, ServerLibraryProvider } from '$lib/sources';
  import { fetchLibraryPage } from '$lib/sources/library';
  import {
    listDeviceManga,
    listOfflineManga,
    deleteOfflineManga,
    deleteImportedManga,
    getMangaDir,
    type FileProgress,
    type Origin
  } from '$lib/sources/native-library';
  import { fetchNativeMeta, fetchServerMeta, serverCoverUrl, type CardMeta } from '$lib/api/meta';
  import {
    startDownload,
    saveMangas,
    cancelDownload,
    downloadProgress,
    downloadsDiscarding
  } from '$lib/sources/download.svelte';
  import {
    serverStatus,
    watchServer,
    checkServer,
    reportServerFailure
  } from '$lib/sources/connection.svelte';
  import { isLocalServer, getServerUrl, ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
  import { isNative } from '$lib/utils/platform';
  import {
    showError,
    addToast,
    updateToast,
    toastId,
    withProgressToast,
    finishBatchToast
  } from '$lib/ui/toast.svelte';
  import { describeOpenFileError } from '$lib/utils/errors';
  import { Download, Trash2, RefreshCw, LibraryBig, ListChecks, X } from 'lucide-svelte';
  import ListPanel from '$lib/ui/ListPanel.svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import Button from '$lib/ui/Button.svelte';
  import MangaCard from './MangaCard.svelte';
  import { TILE_GRID_CLASS } from '$lib/ui/tile-grid';
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

  /// `stale`: rows from before a reset, shown until the first new page replaces them.
  type List = {
    rows: Row[];
    next: string | null;
    loading: boolean;
    loaded: boolean;
    stale: boolean;
  };

  const SERVER_TIMEOUT = 8000;
  const SEARCH_DEBOUNCE = 250;

  const { setSource, events } = getReaderContext();
  const native = isNative();
  const mangaDir = native ? getMangaDir() : '';
  const serverEnabled = isLocalServer || !!getServerUrl();

  const emptyList = (): List => ({
    rows: [],
    next: null,
    loading: false,
    loaded: false,
    stale: false
  });
  const lists: Record<Tab, List> = $state({ device: emptyList(), server: emptyList() });
  // Bumped when a list is reset, so pages still in flight for it are dropped.
  const generation: Record<Tab, number> = { device: 0, server: 0 };
  let deviceError: string | null = $state(null);
  /// Skeleton cards per tab: as many as were on screen before the last reset.
  const skeletons: Record<Tab, number> = $state({ device: 8, server: 8 });

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
  let refreshing = $state(false);
  /// Which tabs had rows when the running refresh emptied them: their Select
  /// button holds still through the reload rather than leaving and returning.
  let hadRows = $state<Record<Tab, boolean>>({ device: false, server: false });
  // Metadata titles, reported by the cards as they load.
  const titles = new SvelteMap<string, string>();
  const displayName = (row: Row) => titles.get(row.id) ?? row.name;

  // A download is deleted by its server slug, an import by its folder name.
  type DeleteTarget = { slug: string; name: string } | { folder: string; name: string };
  let pendingDelete: DeleteTarget | null = $state(null);
  let pendingDownload: { slug: string; name: string } | null = $state(null);

  const tabs: Tab[] = [
    ...(native ? ['device' as const] : []),
    ...(serverEnabled ? ['server' as const] : [])
  ];
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

  function reset(which: Tab, keepRows = false) {
    generation[which]++;
    if (!keepRows && lists[which].rows.length > 0) skeletons[which] = lists[which].rows.length;
    const rows = keepRows ? lists[which].rows : [];
    lists[which] = { ...emptyList(), rows, stale: rows.length > 0 };
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
      if (list.stale) list.rows = page.rows;
      else list.rows.push(...page.rows);
      list.next = page.next;
    } catch {
      if (gen !== generation[which]) return;
      if (list.stale) list.rows = [];
      list.next = null;
      if (which === 'server') reportServerFailure();
      else deviceError = `Could not read manga directory: ${mangaDir}`;
    } finally {
      if (gen === generation[which]) {
        list.loading = false;
        list.loaded = true;
        list.stale = false;
      }
    }
  }

  function loadDownloads() {
    if (!native) return;
    return listOfflineManga()
      .then((list) => {
        downloads.clear();
        for (const d of list) downloads.set(d.slug, d.path);
      })
      .catch(() => {});
  }

  $effect(() => {
    loadDownloads();
    const unwatch = serverEnabled ? watchServer() : () => {};
    // Downloads are listed in the Device tab.
    // Rows already shown stay up while the list reloads, so nothing flashes.
    const onChange = () => {
      loadDownloads();
      reset('device', true);
    };
    // Gone from disk: dropped from the list now, not when it reloads, so the
    // card doesn't show it as downloaded in between.
    const onDeleted = ({ slug }: { slug: string }) => {
      downloads.delete(slug);
      onChange();
    };
    // A download shows in the Device tab from its first file, with its
    // progress bar; it's only counted as downloaded once complete.
    const unsubStarted = events.on('download:started', () => reset('device', true));
    const unsubComplete = events.on('download:complete', onChange);
    const unsubDeleted = events.on('download:deleted', onDeleted);
    const unsubImported = events.on('import:complete', () => reset('device'));
    return () => {
      unwatch();
      unsubStarted();
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

  // A new query starts both lists over, keeping the old results up until the
  // new ones land so the grid doesn't flash skeletons on every keystroke.
  $effect(() => {
    void query;
    untrack(() => {
      reset('device', true);
      reset('server', true);
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

  /// Downloads the Device tab doesn't list yet: a folder only lists once it
  /// holds a finished chapter. Shown first, so a download appears there as soon
  /// as it starts; its real row takes over when it lists.
  const pendingDownloads: Row[] = $derived.by(() => {
    if (!native) return [];
    const listed = lists.device.rows;
    const q = query.toLowerCase();
    return [...downloadProgress]
      .filter(
        ([slug, p]) => !listed.some((r) => r.slug === slug) && p.name.toLowerCase().includes(q)
      )
      .map(([slug, p]) => ({
        id: `device:pending:${slug}`,
        name: p.name,
        path: null,
        slug,
        origin: 'download',
        known: null
      }));
  });

  function visibleRows(t: Tab): Row[] {
    return t === 'device' ? [...pendingDownloads, ...lists.device.rows] : lists[t].rows;
  }

  /// The copy on this device, if there is one: a device folder or a download.
  function localPath(row: Row): string | null {
    return row.path ?? (row.slug ? (downloads.get(row.slug) ?? null) : null);
  }

  /// A finished download: the downloads list also has ones still copying.
  function isDownloaded(row: Row): boolean {
    return !!row.slug && downloads.has(row.slug) && !busy(row.slug);
  }

  /// Downloading, queued, or cancelled with its files still being deleted.
  function busy(slug: string): boolean {
    return downloadProgress.has(slug) || downloadsDiscarding.has(slug);
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
    // While it downloads (or waits to), the button cancels, at once; in the
    // Device tab too, where it lists from its first file.
    if (busy(slug)) {
      return {
        icon: X,
        label: 'Cancel download of',
        // Already cancelled: pulses until its files are gone.
        loading: !downloadProgress.has(slug),
        onclick: () => cancelDownload(slug)
      };
    }
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
      loading: false,
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
      // A copy still downloading is incomplete: the server's is opened instead.
      const path = row.slug && busy(row.slug) ? null : localPath(row);
      if (path) {
        await openNativeManga({ setSource }, path, row.name);
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
    await downloadOne(slug, name);
  }

  /// One manga, with its own chapter-counting toast.
  async function downloadOne(slug: string, name: string) {
    try {
      await startDownload(slug, name, events);
    } catch (err) {
      // fetch rejects with a TypeError when the server can't be reached.
      if (err instanceof TypeError) {
        showError(`Could not reach server to download "${name}"`);
        reportServerFailure();
      } else {
        showError(`Failed to fetch chapters for "${name}"`);
      }
    }
  }

  async function deleteOne(target: DeleteTarget, channel = new Channel<FileProgress>()) {
    if ('slug' in target) {
      await deleteOfflineManga(target.slug, channel);
      events.emit('download:deleted', { slug: target.slug });
    } else {
      await deleteImportedManga(target.folder, channel);
      reset('device');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const { name } = target;
    pendingDelete = null;

    await withProgressToast(name, 'deleting', (progress) =>
      deleteOne(target, new Channel<FileProgress>(progress))
    ).catch(() => {
      // Its toast says so.
    });
  }

  // Selection mode: picked cards get downloaded (Server tab) or deleted (Device
  // tab) together. Native only, as are the single-card actions.
  let selecting = $state(false);
  const selected = new SvelteSet<string>();
  let pendingBulk: { kind: 'download' | 'delete'; rows: Row[] } | null = $state(null);

  /// Whether the current tab's bulk action applies to the row.
  function selectable(row: Row, t: Tab): boolean {
    if (!native) return false;
    if (t === 'device') return row.origin === 'import' || isDownloaded(row);
    return !!row.slug && !row.path && !downloads.has(row.slug) && !busy(row.slug);
  }

  const selectedRows = $derived(
    tab ? lists[tab].rows.filter((r) => selected.has(r.id) && selectable(r, tab)) : []
  );

  function startSelecting(row: Row | null = null) {
    selecting = true;
    if (row && tab && selectable(row, tab)) selected.add(row.id);
  }

  function stopSelecting() {
    selecting = false;
    selected.clear();
  }

  function toggle(row: Row) {
    if (!tab || !selectable(row, tab)) return;
    if (selected.has(row.id)) selected.delete(row.id);
    else selected.add(row.id);
  }

  function selectAll() {
    if (!tab) return;
    const pickable = lists[tab].rows.filter((r) => selectable(r, tab));
    const all = pickable.every((r) => selected.has(r.id));
    for (const r of pickable) {
      if (all) selected.delete(r.id);
      else selected.add(r.id);
    }
  }

  function confirmBulk() {
    if (!pendingBulk) return;
    const { kind, rows } = pendingBulk;
    pendingBulk = null;
    stopSelecting();
    if (kind === 'download' && rows.length === 1) {
      downloadOne(rows[0].slug!, displayName(rows[0]));
    } else if (kind === 'download') {
      saveMangas(
        rows.map((r) => ({ slug: r.slug!, name: displayName(r) })),
        events
      );
    } else {
      deleteMany(
        rows.map((r) =>
          r.origin === 'import'
            ? { folder: r.name, name: displayName(r) }
            : { slug: r.slug!, name: displayName(r) }
        )
      );
    }
  }

  /// Deletes one after another under one toast, which counts manga.
  async function deleteMany(targets: DeleteTarget[]) {
    const id = toastId('del');
    const total = targets.length;
    addToast({ id, label: `Deleting ${total} manga`, current: 0, total, phase: 'deleting' });
    let done = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        await deleteOne(target);
      } catch {
        failed++;
      }
      updateToast(id, { current: ++done });
    }
    finishBatchToast(id, failed, total);
  }

  // Another tab's cards take other actions, so switching tabs ends selecting.
  $effect(() => {
    void tab;
    untrack(stopSelecting);
  });

  // System back leaves selection mode before it leaves anything else.
  $effect(() => {
    if (!native) return;
    const onNativeBack = (e: Event) => {
      if (!selecting) return;
      stopSelecting();
      e.preventDefault();
    };
    window.addEventListener('nativeback', onNativeBack);
    return () => window.removeEventListener('nativeback', onNativeBack);
  });

  /// A small title-row button, drawn as tall as the icon buttons on touch.
  const TOUCH_BUTTON = 'pointer-coarse:h-10 pointer-coarse:px-4 pointer-coarse:text-sm';
  /// The bar's square icon buttons, without their opacity.
  const ICON_BUTTON =
    'hit relative flex size-8 cursor-pointer items-center justify-center hover:bg-fg/10 pointer-coarse:size-10';

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    hadRows = { device: lists.device.rows.length > 0, server: lists.server.rows.length > 0 };
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

  // Header buttons come and go by growing from and shrinking to nothing, the
  // gap before them included, so a button that stays slides over instead of
  // jumping when its neighbour leaves.
  function grow(node: HTMLElement): TransitionConfig {
    const width = node.offsetWidth;
    const parent = node.parentElement;
    const gap =
      parent && parent.children.length > 1
        ? parseFloat(getComputedStyle(parent).columnGap) || 0
        : 0;
    return {
      duration: ANIM_DURATION,
      easing: ANIM_EASE,
      css: (t) =>
        `width: ${t * width}px; margin-left: ${(t - 1) * gap}px; opacity: ${t}; overflow: hidden;`
    };
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

{#if pendingBulk}
  <ConfirmDialog
    message={pendingBulk.kind === 'download'
      ? `Download ${pendingBulk.rows.length} manga? This may take a while depending on size.`
      : `Delete ${pendingBulk.rows.length} manga? This will remove all their chapters from this device.`}
    confirmLabel={pendingBulk.kind === 'download' ? 'Download' : 'Delete'}
    onconfirm={confirmBulk}
    oncancel={() => (pendingBulk = null)}
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
     next to the title when the server is the only source. Not a control of its
     own — refresh retries — since it sits inside the tab's button. -->
{#snippet serverDot()}
  {@const status = serverStatus()}
  <span
    class="flex items-center gap-1.5 text-[11px] font-bold tracking-widest"
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

{#snippet body(t: Tab | null)}
  {#if t === 'device' && deviceError}
    <p class="mb-2 text-xs opacity-60">{deviceError}</p>
  {/if}

  {#if t && (isLoading(t) || refreshing)}
    <div class={TILE_GRID_CLASS}>
      {#each { length: skeletons[t] }, i (i)}
        <div class="flex flex-col gap-1.5">
          <Skeleton class="aspect-[2/3] w-full" />
          <Skeleton class="h-3 w-4/5" />
        </div>
      {/each}
    </div>
  {:else if t && visibleRows(t).length > 0}
    <div class={TILE_GRID_CLASS}>
      {#each visibleRows(t) as row (row.id)}
        {@const action = rowAction(row)}
        <MangaCard
          name={row.name}
          ontitle={(title) => titles.set(row.id, title)}
          metaKey={metaKey(row)}
          loadMeta={metaLoader(row)}
          downloaded={t === 'server' && isDownloaded(row)}
          {action}
          progress={row.slug ? (downloadProgress.get(row.slug) ?? null) : null}
          selection={selecting
            ? selectable(row, t)
              ? selected.has(row.id)
                ? 'selected'
                : 'unselected'
              : 'disabled'
            : null}
          disabled={t === 'device' && !selecting && !!row.slug && busy(row.slug)}
          onopen={() => (selecting ? toggle(row) : openRow(row))}
          onlongpress={native ? () => (selecting ? toggle(row) : startSelecting(row)) : undefined}
        />
      {/each}
    </div>
    <LoadMore onvisible={() => loadMore(t)} watch={lists[t].rows.length} />
  {:else if !deviceError || t !== 'device'}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
      <LibraryBig size={40} class="opacity-25" />
      <div class="flex max-w-64 flex-col gap-1">
        {#if tabs.length === 0}
          <p class="text-base font-bold opacity-80">No manga sources configured</p>
          <p class="text-xs opacity-60">
            <a href="/settings" class="underline">Set one up in Settings</a>
          </p>
        {:else if searchQuery.trim()}
          <p class="text-base font-bold opacity-80">No results for "{searchQuery.trim()}"</p>
        {:else if t === 'server' && serverStatus() === 'offline'}
          <p class="text-base font-bold opacity-80">Server unreachable</p>
        {:else if t === 'device' && !mangaDir}
          <p class="text-base font-bold opacity-80">No manga on this device yet</p>
          <p class="text-xs opacity-60">Download some from the server</p>
        {:else}
          <p class="text-base font-bold opacity-80">No manga found</p>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

<!-- One height in both modes, so the list doesn't jump. On touch screens its
     controls are drawn 40px tall (48px to tap, via `hit`). -->
<div class="box-content flex h-8 shrink-0 items-center gap-3 px-4 pt-8 pb-2 pointer-coarse:h-10">
  {#if selecting && tab}
    <button
      class="{ICON_BUTTON} opacity-60 hover:opacity-100"
      onclick={stopSelecting}
      aria-label="Cancel selection"
    >
      <X size={18} />
    </button>
    <span class="text-sm font-bold tabular-nums">{selectedRows.length} selected</span>
    <span class="ml-auto flex items-center gap-2">
      <Button size="sm" variant="ghost" class={TOUCH_BUTTON} onclick={selectAll}>All</Button>
      <Button
        size="sm"
        variant="primary"
        class={TOUCH_BUTTON}
        disabled={selectedRows.length === 0}
        onclick={() =>
          (pendingBulk = {
            kind: tab === 'server' ? 'download' : 'delete',
            rows: selectedRows
          })}
      >
        {#if tab === 'server'}<Download size={13} /> Download{:else}<Trash2 size={13} /> Delete{/if}
      </Button>
    </span>
  {:else}
    <h1 class="text-2xl font-bold">Library</h1>
    {#if tabs.length === 1 && serverEnabled}{@render serverDot()}{/if}
    <span class="ml-auto flex items-center gap-1">
      {#if native && tab && (lists[tab].rows.length > 0 || (refreshing && hadRows[tab]))}
        <!-- On a wrapper: grow's opacity would override the button's own. -->
        <span class="flex" transition:grow>
          <button
            class="{ICON_BUTTON} opacity-40 hover:opacity-90"
            onclick={() => startSelecting()}
            aria-label="Select"
          >
            <ListChecks size={18} />
          </button>
        </span>
      {/if}
      <!-- Comes and goes with the tab (no refresh for an unset device folder). -->
      {#if tab && !(tab === 'device' && !mangaDir)}
        <span class="flex" transition:grow>
          <button
            class="{ICON_BUTTON} opacity-40 hover:opacity-90"
            onclick={refresh}
            aria-label="Refresh"
          >
            <RefreshCw size={17} class={refreshing ? 'animate-spin' : ''} />
          </button>
        </span>
      {/if}
    </span>
  {/if}
</div>

{#if tabs.length > 0}
  <ListPanel
    tabs={tabs.map((t) =>
      t === 'device' ? { key: t, label: 'DEVICE' } : { key: t, label: 'SERVER', badge: serverDot }
    )}
    activeTab={tab}
    ontab={(key) => selectTab(key as Tab)}
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
