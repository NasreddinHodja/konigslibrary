<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import { ZipUploadProvider } from '$lib/sources';
  import { showError } from '$lib/ui/toast.svelte';
  import { isNative } from '$lib/utils/platform';
  import { describeOpenFileError } from '$lib/utils/errors';
  import { convertFileSrc } from '@tauri-apps/api/core';

  let {
    isDragOver = false,
    compact = false,
    iconOnly = false
  }: { isDragOver?: boolean; compact?: boolean; iconOnly?: boolean } = $props();

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
        showError(`Failed to open file: ${describeOpenFileError(err)}`);
      }
      return;
    }

    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (
          window as unknown as {
            showOpenFilePicker: (opts: object) => Promise<FileSystemFileHandle[]>;
          }
        ).showOpenFilePicker({
          types: [{ description: 'ZIP / CBZ', accept: { 'application/zip': ['.zip', '.cbz'] } }],
          multiple: false
        });
        await loadFile(await handle.getFile());
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        showError(`Failed to open file: ${describeOpenFileError(err)}`);
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
{#if iconOnly}
  <button
    type="button"
    onclick={handleClick}
    aria-label="Upload manga"
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
    OPEN FILE
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
      <span class="text-sm font-bold tracking-widest">OPEN FILE</span>
    </div>
    <span class="text-xs tracking-widest opacity-40">.ZIP · .CBZ</span>
  </button>
{/if}
