<script lang="ts">
  import { fadeOut, fadeInAfter } from '$lib/ui/transitions';
  import { droppedUpload, openUpload } from '$lib/sources/upload';
  import { importFiles } from '$lib/sources/import';
  import { openNativeManga } from '$lib/sources';
  import { resolveKey } from '$lib/keyboard/keybindings.svelte';
  import type { ViewerCommands } from '$lib/commands';
  import { getReaderContext } from '$lib/context';
  import { createPinchZoomController } from '$lib/utils/pinch-zoom-controller.svelte';
  import ReaderScreen from '$lib/ui/ReaderScreen.svelte';
  import MangaDetail from '$lib/ui/MangaDetail.svelte';
  import UploadButton from '$lib/browsers/UploadButton.svelte';
  import MangaLibrary from '$lib/browsers/MangaLibrary.svelte';
  import KeyboardHelp from '$lib/keyboard/KeyboardHelp.svelte';
  import { isNative } from '$lib/utils/platform';
  import { isLocalServer } from '$lib/utils/constants';
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import { CircleQuestionMark } from 'lucide-svelte';
  import AppShell from '$lib/ui/AppShell.svelte';
  import ToastStack from '$lib/ui/ToastStack.svelte';
  import UpdateBanner from '$lib/ui/UpdateBanner.svelte';
  import { showError } from '$lib/ui/toast.svelte';
  import { describeOpenFileError } from '$lib/utils/errors';
  import { fetchDownloadLinks, DEFAULT_DOWNLOAD_LINKS } from '$lib/utils/update';
  import { onMount, untrack } from 'svelte';

  const reader = getReaderContext();

  const { state: manga, commands: registry } = reader;
  const native = isNative();
  const chapters = $derived(reader.chapters);

  let helpOpen = $state(false);
  let viewerCommands: ViewerCommands | null = $state(null);
  let readerEl: HTMLDivElement | undefined = $state();

  let downloads = $state(DEFAULT_DOWNLOAD_LINKS);

  onMount(async () => {
    if (!native && !isLocalServer) downloads = await fetchDownloadLinks();
  });

  let dragCount = $state(0);
  const isDragOver = $derived(dragCount > 0 && chapters.length === 0);

  const pz = createPinchZoomController(
    () => readerEl,
    () => manga.selectedChapter
  );

  const handleDrop = async (e: DragEvent) => {
    if (!e.dataTransfer) return;
    try {
      const upload = await droppedUpload(e.dataTransfer);
      if (!upload) return;
      if (!native) return await openUpload(reader, upload);
      // Native builds keep what is dropped, like what is picked.
      const path = await importFiles(upload.name, upload.files, reader.events).catch(() => null);
      if (!path) return;
      await openNativeManga(reader, path, upload.name);
    } catch (err) {
      showError(`Failed to open file: ${describeOpenFileError(err)}`);
    }
  };

  // Every back — browser, Android, the app's back buttons and the `b` key —
  // goes one layer up: overlay, reader, manga detail, library. While a manga
  // is open the current history entry is one pushed for it, so each of them
  // is `history.back()`, and popping that entry closes the topmost layer.

  /// Closes the topmost thing open.
  function back() {
    if (pz.overlayActive) pz.deactivateOverlay();
    else if (helpOpen) helpOpen = false;
    else if (manga.selectedChapter !== null) manga.selectedChapter = null;
    else if (chapters.length > 0) reader.clearManga();
  }

  // A boolean, so opening another manga while one is open doesn't push a
  // second history entry.
  const hasManga = $derived(chapters.length > 0);

  // A manga's entry with the manga gone (closed from the library tab, or
  // reached with forward) is popped, so the next back isn't a dead press.
  $effect(() => {
    if (!hasManga && page.state.kl === 'reader') history.back();
  });

  $effect(() => {
    if (!hasManga) return;

    // Already on the manga's entry when coming back to it from settings.
    // Untracked: SvelteKit's own popstate update of `page` would otherwise
    // re-run this effect, dropping the listener below before it fires.
    untrack(() => {
      if (page.state.kl !== 'reader') pushState('', { kl: 'reader' });
    });

    const onPopState = () => {
      back();
      if (chapters.length > 0) pushState('', { kl: 'reader' });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  $effect(() => {
    if (!native) return;
    const onNativeBack = (e: Event) => {
      if (!hasManga) return;
      e.preventDefault();
      history.back();
    };
    window.addEventListener('nativeback', onNativeBack);
    return () => window.removeEventListener('nativeback', onNativeBack);
  });

  const handleKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (chapters.length === 0) return;

    const action = resolveKey(event.key);
    if (!action) return;

    if (action === 'holdZoom') {
      viewerCommands?.holdZoom?.(true);
      return;
    }

    if (action === 'showHelp') {
      event.preventDefault();
      helpOpen = !helpOpen;
      return;
    }

    if (helpOpen) {
      if (action === 'close') {
        event.preventDefault();
        helpOpen = false;
      }
      return;
    }

    event.preventDefault();
    registry.execute(action, { reader, viewer: viewerCommands });
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (resolveKey(event.key) === 'holdZoom') viewerCommands?.holdZoom?.(false);
  };

  const handleBlur = () => {
    viewerCommands?.holdZoom?.(false);
  };
</script>

<svelte:window onkeydown={handleKey} onkeyup={handleKeyUp} onblur={handleBlur} />

<svelte:document
  ondragenter={() => {
    dragCount++;
  }}
  ondragleave={() => {
    dragCount = Math.max(0, dragCount - 1);
  }}
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => {
    e.preventDefault();
    dragCount = 0;
    handleDrop(e);
  }}
/>

<UpdateBanner />
<ToastStack />

{#if helpOpen}
  <KeyboardHelp onclose={() => (helpOpen = false)} />
{/if}

{#if chapters.length > 0 && manga.selectedChapter !== null}
  <ReaderScreen bind:el={readerEl} bind:viewerCommands {pz} />
{:else if native || isLocalServer}
  <!-- AppShell mounted once here so the nav rail/tab bar is persistent chrome that never
       fades — only the content below (library vs detail) crossfades between the two. -->
  <AppShell active="library" {isDragOver}>
    {#if chapters.length === 0}
      <div
        class="flex h-dvh w-full flex-col md:pl-14"
        style="padding-top: var(--safe-top)"
        out:fadeOut
        in:fadeInAfter
      >
        <!-- The library scrolls inside its own tab pages (ListPanel's fill
             layout), so this only gives it the height left under the status
             bar. Same column as the manga detail page. -->
        <div class="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col md:px-4">
          <!-- The library fills the screen; the app's title lives in Settings. -->
          <MangaLibrary />
        </div>
      </div>
    {:else}
      <div class="md:pl-14" out:fadeOut in:fadeInAfter>
        <MangaDetail />
      </div>
    {/if}
  </AppShell>
{:else if chapters.length === 0}
  <div class="flex h-dvh w-full flex-col items-center" out:fadeOut in:fadeInAfter>
    <a
      href="/about"
      class="hit fixed z-10 text-dim hover:text-fg"
      style="top: calc(1rem + var(--safe-top)); right: calc(1rem + var(--safe-right))"
      aria-label="How to use"
    >
      <CircleQuestionMark size={18} />
    </a>

    <div
      class="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-10 px-6 py-12"
      style="padding-top: var(--safe-top); padding-bottom: var(--safe-bottom)"
    >
      <div class="flex w-full flex-col items-center gap-8">
        <h1 class="text-4xl font-bold tracking-widest">KONIGSLIBRARY</h1>
        <UploadButton {isDragOver} />
      </div>

      <div class="w-full border-t border-line pt-6">
        <p class="mb-1 text-xs font-bold tracking-widest text-dim">RUN LOCALLY</p>
        <p class="mb-5 text-sm text-dim">Serve manga from your PC to any device on your network.</p>
        <div class="flex flex-wrap gap-3">
          <a
            href={downloads.windows}
            class="hit relative border-2 border-line-strong px-4 py-2 text-sm hover:border-fg hover:bg-fg/10"
          >
            Windows
          </a>
          <a
            href={downloads.linux}
            class="hit relative border-2 border-line-strong px-4 py-2 text-sm hover:border-fg hover:bg-fg/10"
          >
            Linux
          </a>
          <a
            href={downloads.android}
            class="hit relative border-2 border-line-strong px-4 py-2 text-sm hover:border-fg hover:bg-fg/10"
          >
            Android
          </a>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div out:fadeOut in:fadeInAfter>
    <MangaDetail />
  </div>
{/if}
