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
  import MangaList from './MangaList.svelte';
  import { showError } from '$lib/ui/toast.svelte';
  import { describeOpenFileError } from '$lib/utils/errors';

  const { setSource } = getReaderContext();

  let entries: NativeMangaEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  const mangaDir = getMangaDir();

  const listEntries = $derived(entries.map((e) => ({ id: e.path, name: e.name })));

  async function loadEntries() {
    loading = true;
    error = null;
    try {
      entries = await listNativeManga();
    } catch {
      error = `Could not read manga directory: ${mangaDir}`;
    }
    loading = false;
  }

  $effect(() => {
    loadEntries();
  });

  async function open(path: string) {
    try {
      const entry = entries.find((e) => e.path === path)!;
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
    } catch (err) {
      showError(describeOpenFileError(err));
    }
  }
</script>

{#if !mangaDir}
  <p class="text-sm opacity-60">
    No manga directory set - <a href="/settings" class="underline">configure in Settings</a>
  </p>
{:else}
  <MangaList
    title="DEVICE LIBRARY"
    entries={listEntries}
    {loading}
    {error}
    onopen={open}
    onrefresh={loadEntries}
  />
{/if}
