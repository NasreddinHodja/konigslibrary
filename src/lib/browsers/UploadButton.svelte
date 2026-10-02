<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { getReaderContext } from '$lib/context';
  import { openNativeManga } from '$lib/sources';
  import { openUpload, pickedFolder } from '$lib/sources/upload';
  import { importFiles, importFolder, nameForFiles } from '$lib/sources/import';
  import { showError } from '$lib/ui/toast.svelte';
  import { ZIP_EXT } from '$lib/utils/constants';
  import { isAndroid, isNative } from '$lib/utils/platform';
  import { describeOpenFileError } from '$lib/utils/errors';
  import { Upload } from 'lucide-svelte';

  let {
    isDragOver = false,
    iconOnly = false,
    tab = false
  }: { isDragOver?: boolean; iconOnly?: boolean; tab?: boolean } = $props();

  const reader = getReaderContext();
  // The dialog plugin has no folder picker on mobile, so Android picks a
  // manga's chapter archives instead.
  const pickFiles = isAndroid();

  // Native builds keep what they open; the browser only reads it.
  const label = pickFiles ? 'ADD CHAPTERS' : isNative() ? 'ADD FOLDER' : 'OPEN FOLDER';

  let folderInput = $state<HTMLInputElement | null>(null);

  /// Picked files arrive as content URIs on Android, readable through the
  /// asset protocol only until the device restarts — hence the import. Some
  /// providers name a document by id rather than filename; the picker only
  /// offered archives, so such a file still counts as one.
  async function readPicked(uri: string): Promise<File> {
    const blob = await (await fetch(convertFileSrc(uri))).blob();
    const last = decodeURIComponent(uri.split(/[\\/]/).pop() ?? 'chapter');
    const name = last.split(':').pop() || last;
    return new File([blob], ZIP_EXT.test(name) ? name : `${name}.cbz`);
  }

  async function handleClick() {
    if (!isNative()) {
      folderInput?.click();
      return;
    }
    let imported: string | null;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      if (pickFiles) {
        const picked = await open({
          multiple: true,
          filters: [{ name: 'CBZ', extensions: ['cbz', 'zip'] }]
        });
        if (!picked || picked.length === 0) return;
        const files = await Promise.all(picked.map(readPicked));
        imported = await importFiles(await nameForFiles(files), files, reader.events).catch(
          () => null
        );
      } else {
        const path = await open({ multiple: false, directory: true });
        if (!path) return;
        imported = await importFolder(path, reader.events).catch(() => null);
      }
    } catch (err) {
      showError(`Failed to open: ${describeOpenFileError(err)}`);
      return;
    }
    // A failed import has already said so in its toast.
    if (!imported) return;
    try {
      await openNativeManga(reader, imported);
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
{#if tab}
  <!-- An entry in the mobile tab bar, styled like its neighbours. -->
  <button
    type="button"
    onclick={handleClick}
    class="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 self-stretch {isDragOver
      ? ''
      : 'opacity-50 hover:opacity-90'}"
  >
    <Upload size={16} />
    <span class="text-[11px] font-bold tracking-wide uppercase">Upload</span>
  </button>
{:else if iconOnly}
  <button
    type="button"
    onclick={handleClick}
    aria-label={pickFiles ? 'Add chapters' : 'Add manga folder'}
    class="flex h-8 w-8 cursor-pointer items-center justify-center border-2 transition-colors {isDragOver
      ? 'border-fg bg-fg/10'
      : 'border-fg/30 bg-bg hover:border-fg hover:bg-fg/10'}"
  >
    <Upload size={14} stroke-linecap="square" stroke-linejoin="miter" />
  </button>
{:else}
  <button
    type="button"
    onclick={handleClick}
    class="group flex w-full cursor-pointer items-center justify-between border-2 px-5 py-4 transition-colors duration-150 md:flex-col md:gap-4 md:py-12
      {isDragOver ? 'border-fg bg-fg/5' : 'border-fg/25 hover:border-fg/70 hover:bg-fg/[0.03]'}"
  >
    <div class="flex items-center gap-4">
      <Upload
        size={18}
        strokeWidth={1.5}
        stroke-linecap="square"
        stroke-linejoin="miter"
        class="shrink-0 transition-opacity {isDragOver
          ? 'opacity-80'
          : 'opacity-40 group-hover:opacity-70'}"
      />
      <span class="text-sm font-bold tracking-widest">{label}</span>
    </div>
    <span class="text-xs tracking-widest opacity-40"
      >{pickFiles ? '.CBZ CHAPTERS' : 'COVER + .CBZ CHAPTERS'}</span
    >
  </button>
{/if}
