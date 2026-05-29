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
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import { RefreshCw } from 'lucide-svelte';

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

<div class="w-full min-w-0">
  <div class="mb-2 flex items-center gap-3">
    <p class="text-xs font-bold tracking-widest opacity-30">DEVICE LIBRARY</p>
    <button
      class="cursor-pointer opacity-20 hover:opacity-70"
      onclick={loadEntries}
      aria-label="Refresh"
    >
      <RefreshCw size={12} />
    </button>
  </div>

  {#if !mangaDir}
    <p class="text-sm opacity-40">
      No path set - <a href="/settings" class="underline">configure in Settings</a>
    </p>
  {:else if loading}
    <div class="border-2">
      {#each [170, 200, 145, 185] as w (w)}
        <div class="flex items-center border-b border-fg/10 px-4 py-3 last:border-b-0">
          <Skeleton class="h-5" style="width: {w}px" />
        </div>
      {/each}
    </div>
  {:else if error}
    <p class="text-sm opacity-40">{error}</p>
  {:else if entries.length > 0}
    <div class="border-2">
      {#each entries as entry (entry.path)}
        <button
          class="flex w-full cursor-pointer items-center border-b border-fg/10 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-fg/10"
          onclick={() => openEntry(entry)}
        >
          <span class="truncate">{entry.name}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="text-sm opacity-40">
      No manga found in <code class="opacity-60">{mangaDir}/</code>
    </p>
  {/if}
</div>
