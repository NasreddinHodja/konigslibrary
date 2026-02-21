<script lang="ts">
  import {
    listNativeManga,
    listNativeChapters,
    getMangaDir,
    type NativeMangaEntry
  } from '$lib/sources/native-library';
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { getReaderContext } from '$lib/context';
  import { ZipUploadProvider, NativeFilesystemProvider } from '$lib/sources';
  import { BookOpen, FileArchive, RefreshCw } from 'lucide-svelte';
  import Loader from '$lib/ui/Loader.svelte';

  const { setSource } = getReaderContext();

  let entries: NativeMangaEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  const mangaDir = getMangaDir();

  async function loadEntries() {
    loading = true;
    error = null;
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
      const url = convertFileSrc(entry.path);
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], entry.name + '.cbz', { type: 'application/zip' });
      await setSource(new ZipUploadProvider(file));
    } else {
      const chapters = await listNativeChapters(entry.path);
      await setSource(new NativeFilesystemProvider(chapters, entry.name));
    }
  }
</script>

<div class="w-full max-w-2xl space-y-2">
  <div class="mb-4 flex items-center gap-3">
    <h2 class="text-lg font-bold opacity-80">Device Library</h2>
    <button class="opacity-40 hover:opacity-80" onclick={loadEntries} aria-label="Refresh">
      <RefreshCw size={16} />
    </button>
  </div>

  {#if !mangaDir}
    <p class="text-sm opacity-40">
      No path set — <a href="/settings" class="underline hover:opacity-80">configure in Settings</a>
    </p>
  {:else if loading}
    <Loader />
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
      No manga found in <code>{mangaDir}/</code>
    </p>
  {/if}
</div>
