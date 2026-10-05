<script lang="ts">
  import Icon from '$lib/ui/Icon.svelte';
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { getReaderContext } from '$lib/context';
  import { openNativeManga } from '$lib/sources';
  import { openUpload, pickedFolder } from '$lib/sources/upload';
  import { importFiles, importFolder, nameForFiles } from '$lib/sources/import';
  import { showError } from '$lib/ui/toast.svelte';
  import { ZIP_EXT } from '$lib/utils/constants';
  import { isAndroid, isNative } from '$lib/utils/platform';
  import { describeOpenFileError } from '$lib/utils/errors';

  let {
    isDragOver = false,
    rail = false,
    tab = false
  }: { isDragOver?: boolean; rail?: boolean; tab?: boolean } = $props();

  const reader = getReaderContext();
  // The dialog plugin has no folder picker on mobile, so Android picks a
  // manga's chapter archives instead.
  const pickFiles = isAndroid();

  // Native builds keep what they open; the browser only reads it.
  const label = pickFiles ? 'add chapters' : isNative() ? 'add folder' : 'open folder';

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
{#if tab || rail}
  <!-- A boxed word in the mobile tab bar or the desktop rail, like its
       neighbours; a drag over the window inverts it. -->
  <button
    type="button"
    onclick={handleClick}
    aria-label={rail ? label : undefined}
    class="flex cursor-pointer flex-col items-center justify-center gap-1 border border-ink py-1 leading-4 {tab
      ? 'flex-1 self-stretch'
      : 'w-full'} {isDragOver ? 'bg-ink text-bg' : 'text-ink hover:bg-ink3 hover:text-hi'}"
  >
    <Icon name="upload" />
    upload
  </button>
{:else}
  <button
    type="button"
    onclick={handleClick}
    class="flex w-full cursor-pointer flex-col items-start gap-2 panel px-4 py-4 text-left md:items-center md:py-12
      {isDragOver ? 'bg-ink3' : 'hover:bg-ink3'}"
  >
    <span class="flex items-center gap-2 text-ink"><Icon name="upload" /> {label}</span>
    <span class="text-dim">{pickFiles ? '.cbz chapters' : 'cover + .cbz chapters'}</span>
  </button>
{/if}
