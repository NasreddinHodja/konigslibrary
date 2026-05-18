<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import { ZipUploadProvider } from '$lib/sources';
  import { showError } from '$lib/ui/toast.svelte';
  import { isNative } from '$lib/utils/platform';
  import { convertFileSrc } from '@tauri-apps/api/core';

  let { isDragOver = false }: { isDragOver?: boolean } = $props();

  const { setSource } = getReaderContext();

  async function handleClick() {
    if (isNative()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const filePath = await open({
          multiple: false,
          filters: [{ name: 'ZIP / CBZ', extensions: ['zip', 'cbz'] }]
        });
        if (!filePath || typeof filePath !== 'string') return;
        const url = convertFileSrc(filePath);
        const response = await fetch(url);
        const blob = await response.blob();
        const fileName = filePath.split('/').pop() ?? 'manga.cbz';
        const file = new File([blob], fileName, { type: 'application/zip' });
        await setSource(new ZipUploadProvider(file));
      } catch (err) {
        showError(`Failed to open file: ${err instanceof Error ? err.message : err}`);
      }
      return;
    }

    if (!('showOpenFilePicker' in window)) {
      showError('File picker not supported — try dragging your file here instead');
      return;
    }
    try {
      const picker = (
        window as unknown as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }
      ).showOpenFilePicker;
      const [handle] = await picker({
        types: [{ description: 'ZIP / CBZ', accept: { 'application/zip': ['.zip', '.cbz'] } }],
        multiple: false
      });
      await setSource(new ZipUploadProvider(await handle.getFile()));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      showError(`Failed to open file: ${err instanceof Error ? err.message : err}`);
    }
  }
</script>

<button
  type="button"
  onclick={handleClick}
  class="group flex w-full max-w-lg cursor-pointer flex-col items-center justify-center gap-3 border-2 px-8 py-16 text-center transition-colors duration-150
    {isDragOver ? 'border-white bg-white/5' : 'border-white/30 hover:border-white/70'}"
>
  <span class="block text-3xl font-bold tracking-wider">DROP FILE HERE</span>
  <span class="block text-xs tracking-widest opacity-30">.ZIP · .CBZ</span>
  <span
    class="mt-4 inline-block border-2 border-white/50 px-6 py-2 text-sm font-bold tracking-wide group-hover:border-white group-hover:bg-white/10"
  >
    OR BROWSE
  </span>
</button>
