<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import { ZipUploadProvider } from '$lib/sources';
  import { showError } from '$lib/ui/toast.svelte';
  import { isNative } from '$lib/utils/platform';
  import { convertFileSrc } from '@tauri-apps/api/core';

  let { isDragOver = false }: { isDragOver?: boolean } = $props();

  const { setSource } = getReaderContext();

  let fileInput = $state<HTMLInputElement | null>(null);

  async function loadFile(file: File) {
    await setSource(new ZipUploadProvider(file));
  }

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
        await loadFile(file);
      } catch (err) {
        showError(`Failed to open file: ${err instanceof Error ? err.message : err}`);
      }
      return;
    }

    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'ZIP / CBZ', accept: { 'application/zip': ['.zip', '.cbz'] } }],
          multiple: false
        });
        await loadFile(await handle.getFile());
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        showError(`Failed to open file: ${err instanceof Error ? err.message : err}`);
        return;
      }
    }

    fileInput?.click();
  }

  async function handleInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    try {
      await loadFile(file);
    } catch (err) {
      showError(`Failed to open file: ${err instanceof Error ? err.message : err}`);
    }
  }
</script>

<input
  bind:this={fileInput}
  type="file"
  accept=".zip,.cbz"
  onchange={handleInputChange}
  class="hidden"
/>
<button
  type="button"
  onclick={handleClick}
  class="group flex w-full max-w-lg cursor-pointer flex-col items-center justify-center gap-3 border-2 px-8 py-16 text-center transition-colors duration-150
    {isDragOver ? 'border-white bg-white/5' : 'border-white/30 hover:border-white/70'}"
>
  <span class="block text-xl font-bold tracking-wider">SELECT MANGA FILE</span>
  <span class="block text-xs tracking-widest opacity-30">.ZIP · .CBZ</span>
  <span class="hidden text-xs tracking-widest opacity-30 md:block">or drag and drop</span>
</button>
