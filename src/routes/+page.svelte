<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import { ZipUploadProvider } from '$lib/sources';
  import { resolveKey } from '$lib/keyboard/keybindings.svelte';
  import type { ViewerCommands } from '$lib/commands';
  import { createReader, setReaderContext } from '$lib/context';
  import { createPinchZoomController } from '$lib/utils/pinch-zoom-controller.svelte';
  import ReaderScreen from '$lib/ui/ReaderScreen.svelte';
  import MangaDetail from '$lib/ui/MangaDetail.svelte';
  import UploadButton from '$lib/browsers/UploadButton.svelte';
  import LibraryBrowser from '$lib/browsers/LibraryBrowser.svelte';
  import NativeLibraryBrowser from '$lib/browsers/NativeLibraryBrowser.svelte';
  import OfflineBrowser from '$lib/browsers/OfflineBrowser.svelte';
  import KeyboardHelp from '$lib/keyboard/KeyboardHelp.svelte';
  import { isNative } from '$lib/utils/platform';
  import { isLocalServer, getServerUrl } from '$lib/utils/constants';
  import { pushState } from '$app/navigation';
  import { CircleQuestionMark, Settings } from 'lucide-svelte';
  import ToastStack from '$lib/ui/ToastStack.svelte';
  import UpdateBanner from '$lib/ui/UpdateBanner.svelte';
  import { showError } from '$lib/ui/toast.svelte';
  import { describeOpenFileError } from '$lib/utils/errors';

  const reader = createReader();
  setReaderContext(reader);
  onDestroy(() => reader.plugins.destroy());

  const { state: manga, commands: registry } = reader;
  const native = isNative();
  const serverUrl = getServerUrl();
  const chapters = $derived(reader.chapters);

  let helpOpen = $state(false);
  let viewerCommands: ViewerCommands | null = $state(null);
  let readerEl: HTMLDivElement | undefined = $state();

  let dragCount = $state(0);
  const isDragOver = $derived(dragCount > 0 && chapters.length === 0);

  const pz = createPinchZoomController(
    () => readerEl,
    () => manga.selectedChapter
  );

  const handleDrop = async (e: DragEvent) => {
    const file = e.dataTransfer?.files[0];
    if (!file || !/\.(zip|cbz)$/i.test(file.name)) return;
    try {
      await reader.setSource(new ZipUploadProvider(file));
    } catch (err) {
      showError(`Failed to open file: ${describeOpenFileError(err)}`);
    }
  };

  $effect(() => {
    if (chapters.length === 0) return;

    pushState('', { kl: 'reader' });

    const onPopState = () => {
      if (pz.overlayActive) {
        pz.deactivateOverlay();
        pushState('', { kl: 'reader' });
        return;
      }
      if (helpOpen) {
        helpOpen = false;
        pushState('', { kl: 'reader' });
      } else if (manga.selectedChapter !== null) {
        manga.selectedChapter = null;
        pushState('', { kl: 'reader' });
      } else {
        reader.clearManga();
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  $effect(() => {
    if (!native) return;
    const onNativeBack = (e: Event) => {
      if (helpOpen) {
        helpOpen = false;
        e.preventDefault();
        return;
      }
      if (manga.selectedChapter !== null) {
        manga.selectedChapter = null;
        e.preventDefault();
        return;
      }
      if (chapters.length > 0) {
        reader.clearManga();
        e.preventDefault();
      }
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

{#if chapters.length === 0}
  <div
    class="flex min-h-screen flex-col"
    out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
    in:fade={{ duration: ANIM_DURATION, delay: ANIM_EXIT_DURATION, easing: ANIM_EASE }}
  >
    {#if !native}
      <a
        href="/about"
        class="fixed z-10 opacity-60 hover:opacity-100"
        style="top: calc(1rem + var(--safe-top)); right: calc(1rem + var(--safe-right))"
        aria-label="How to use"
      >
        <CircleQuestionMark size={18} />
      </a>
    {/if}

    <div
      class="mx-auto flex w-full max-w-lg flex-1 flex-col items-center gap-8 px-6"
      style="padding-top: calc(4rem + var(--safe-top)); padding-bottom: calc(2.5rem + var(--safe-bottom))"
    >
      <h1 class="text-4xl font-bold tracking-widest">KONIGSLIBRARY</h1>

      <UploadButton {isDragOver} />

      {#if native || isLocalServer}
        <div class="flex w-full flex-col gap-8">
          {#if native}<OfflineBrowser />{/if}
          {#if isLocalServer || serverUrl}<LibraryBrowser />{/if}
          {#if native}<NativeLibraryBrowser />{/if}
        </div>
        <a
          href="/settings"
          class="flex items-center gap-1.5 text-xs tracking-widest opacity-40 hover:opacity-70"
          ><Settings size={12} />SETTINGS</a
        >
      {:else}
        <div class="flex w-full flex-col gap-8">
          {#if native}<OfflineBrowser />{/if}

          <div class="border-t border-border/10 pt-6">
            <p class="mb-1 text-xs font-bold tracking-widest opacity-50">RUN LOCALLY</p>
            <p class="mb-5 text-sm opacity-60">
              Serve manga from your PC to any device on your network.
            </p>
            <div class="flex flex-wrap gap-3">
              <a
                href="/download/konigslibrary.sh"
                download
                class="border-2 border-fg/30 px-4 py-2 text-sm hover:border-fg hover:bg-fg/10"
              >
                Linux / Mac
              </a>
              <a
                href="/download/konigslibrary.bat"
                download
                class="border-2 border-fg/30 px-4 py-2 text-sm hover:border-fg hover:bg-fg/10"
              >
                Windows
              </a>
              <a
                href="https://github.com/NasreddinHodja/konigslibrary/releases/latest/download/konigslibrary.apk"
                class="border-2 border-fg/30 px-4 py-2 text-sm hover:border-fg hover:bg-fg/10"
              >
                Android
              </a>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{:else if manga.selectedChapter === null}
  <div
    out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
    in:fade={{ duration: ANIM_DURATION, delay: ANIM_EXIT_DURATION, easing: ANIM_EASE }}
  >
    <MangaDetail />
  </div>
{:else}
  <ReaderScreen bind:el={readerEl} bind:viewerCommands {pz} />
{/if}
