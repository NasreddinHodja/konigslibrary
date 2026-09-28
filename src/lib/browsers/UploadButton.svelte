<script lang="ts">
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { getReaderContext } from '$lib/context';
  import { NativeFilesystemProvider } from '$lib/sources';
  import { openUpload, pickedFolder, singleArchive } from '$lib/sources/upload';
  import { listNativeChapters } from '$lib/sources/native-library';
  import { showError } from '$lib/ui/toast.svelte';
  import { isAndroid, isNative } from '$lib/utils/platform';
  import { describeOpenFileError } from '$lib/utils/errors';

  let {
    isDragOver = false,
    compact = false,
    iconOnly = false
  }: { isDragOver?: boolean; compact?: boolean; iconOnly?: boolean } = $props();

  const reader = getReaderContext();
  // The dialog plugin has no folder picker on mobile, so Android opens a single
  // chapter archive instead.
  const pickFile = isAndroid();

  let folderInput = $state<HTMLInputElement | null>(null);

  async function openNativeFolder(path: string) {
    await invoke('open_manga_folder', { path });
    const chapters = await listNativeChapters(path);
    const name = path.split(/[\\/]/).pop() ?? path;
    await reader.setSource(new NativeFilesystemProvider(chapters, name, path));
  }

  async function openNativeFile(path: string) {
    const blob = await (await fetch(convertFileSrc(path))).blob();
    const file = new File([blob], path.split(/[\\/]/).pop() ?? 'chapter.cbz');
    const upload = singleArchive(file);
    if (upload) await openUpload(reader, upload);
  }

  async function handleClick() {
    if (!isNative()) {
      folderInput?.click();
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open(
        pickFile
          ? { multiple: false, filters: [{ name: 'CBZ', extensions: ['cbz', 'zip'] }] }
          : { multiple: false, directory: true }
      );
      if (!path || typeof path !== 'string') return;
      await (pickFile ? openNativeFile(path) : openNativeFolder(path));
    } catch (err) {
      showError(`Failed to open: ${describeOpenFileError(err)}`);
    }
  }

  async function handleFolderChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const upload = input.files ? pickedFolder(input.files) : null;
    input.value = '';
    if (!upload) return;
    try {
      await openUpload(reader, upload);
    } catch (err) {
      showError(`Failed to open: ${describeOpenFileError(err)}`);
    }
  }
</script>

<input
  bind:this={folderInput}
  type="file"
  webkitdirectory
  onchange={handleFolderChange}
  class="hidden"
/>
{#if iconOnly}
  <button
    type="button"
    onclick={handleClick}
    aria-label={pickFile ? 'Open chapter' : 'Open manga folder'}
    class="flex h-8 w-8 cursor-pointer items-center justify-center border-2 transition-colors {isDragOver
      ? 'border-fg bg-fg/10'
      : 'border-fg/30 bg-bg hover:border-fg hover:bg-fg/10'}"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="square"
      stroke-linejoin="miter"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  </button>
{:else if compact}
  <button
    type="button"
    onclick={handleClick}
    class="flex cursor-pointer items-center gap-1.5 text-xs tracking-widest transition-opacity {isDragOver
      ? 'opacity-90'
      : 'opacity-40 hover:opacity-70'}"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="square"
      stroke-linejoin="miter"
      class="shrink-0"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
    {pickFile ? 'OPEN CHAPTER' : 'OPEN FOLDER'}
  </button>
{:else}
  <button
    type="button"
    onclick={handleClick}
    class="group flex w-full cursor-pointer items-center justify-between border-2 px-5 py-4 transition-colors duration-150 md:flex-col md:gap-4 md:py-12
      {isDragOver ? 'border-fg bg-fg/5' : 'border-fg/25 hover:border-fg/70 hover:bg-fg/[0.03]'}"
  >
    <div class="flex items-center gap-4">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="square"
        stroke-linejoin="miter"
        class="shrink-0 transition-opacity {isDragOver
          ? 'opacity-80'
          : 'opacity-40 group-hover:opacity-70'}"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span class="text-sm font-bold tracking-widest"
        >{pickFile ? 'OPEN CHAPTER' : 'OPEN FOLDER'}</span
      >
    </div>
    <span class="text-xs tracking-widest opacity-40"
      >{pickFile ? '.CBZ' : 'COVER + .CBZ CHAPTERS'}</span
    >
  </button>
{/if}
