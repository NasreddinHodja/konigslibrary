<script lang="ts">
  import {
    listNativeManga,
    listNativeChapters,
    loadNativeZipAsFile,
    getMangaDir,
    setMangaDir,
    requestStoragePermission,
    type NativeMangaEntry
  } from '$lib/native-library';
  import { getReaderContext } from '$lib/context';
  import { ZipUploadProvider, NativeFilesystemProvider } from '$lib/sources';
  import { BookOpen, FileArchive, RefreshCw, Settings } from 'lucide-svelte';
  import Loader from '$lib/ui/Loader.svelte';
  import Button from '$lib/ui/Button.svelte';

  const { setSource } = getReaderContext();

  let entries: NativeMangaEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let mangaDir = $state(getMangaDir());
  let showConfig = $state(false);
  let permissionDenied = $state(false);

  async function loadEntries() {
    loading = true;
    error = null;
    permissionDenied = false;
    const granted = await requestStoragePermission();
    if (!granted) {
      permissionDenied = true;
      loading = false;
      return;
    }
    try {
      entries = await listNativeManga();
    } catch {
      error = `Could not read ${mangaDir}`;
    }
    loading = false;
  }

  $effect(() => {
    loadEntries();
  });

  async function openEntry(entry: NativeMangaEntry) {
    if (entry.type === 'zip') {
      const file = await loadNativeZipAsFile(entry.uri, entry.name);
      await setSource(new ZipUploadProvider(file));
    } else {
      const chapters = await listNativeChapters(entry.path);
      await setSource(new NativeFilesystemProvider(chapters, entry.name));
    }
  }

  function saveDir() {
    setMangaDir(mangaDir);
    showConfig = false;
    loadEntries();
  }
</script>

<div class="w-full max-w-2xl space-y-2">
  <div class="mb-4 flex items-center gap-3">
    <h2 class="text-lg font-bold opacity-80">Device Library</h2>
    <button class="opacity-40 hover:opacity-80" onclick={loadEntries} aria-label="Refresh">
      <RefreshCw size={16} />
    </button>
    <button
      class="opacity-40 hover:opacity-80"
      onclick={() => (showConfig = !showConfig)}
      aria-label="Settings"
    >
      <Settings size={16} />
    </button>
  </div>

  {#if showConfig}
    <div class="mb-4 space-y-2">
      <p class="text-sm opacity-60">Absolute path to manga folder on device</p>
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={mangaDir}
          placeholder="/storage/emulated/0/Manga"
          class="flex-1 border-2 bg-black px-3 py-2 text-sm text-white placeholder:opacity-40"
        />
        <Button size="md" onclick={saveDir}>Save</Button>
      </div>
    </div>
  {/if}

  {#if loading}
    <Loader />
  {:else if permissionDenied}
    <p class="text-sm opacity-60">
      Storage permission required. Go to Settings &gt; Apps &gt; konigslibrary &gt; Permissions.
    </p>
  {:else if error}
    <p class="text-sm opacity-60">{error}</p>
  {:else if entries.length > 0}
    {#each entries as entry (entry.path)}
      <button
        class="flex w-full cursor-pointer items-center gap-3 border-2 px-4 py-3 text-left hover:bg-white/10"
        onclick={() => openEntry(entry)}
      >
        {#if entry.type === 'zip'}
          <FileArchive size={20} class="shrink-0 opacity-60" />
        {:else}
          <BookOpen size={20} class="shrink-0 opacity-60" />
        {/if}
        <span class="truncate">{entry.name}</span>
      </button>
    {/each}
  {:else}
    <p class="text-sm opacity-40">
      No manga found. Place ZIP/CBZ files or folders in the <code>{mangaDir}/</code> directory.
    </p>
  {/if}
</div>
