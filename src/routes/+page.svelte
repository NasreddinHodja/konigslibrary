<script lang="ts">
  import { ZipUploadProvider } from '$lib/sources';
  import { resolveKey } from '$lib/keybindings.svelte';
  import type { ViewerCommands } from '$lib/commands';
  import { createReaderServices, setReaderContext } from '$lib/context';
  import Sidebar from '$lib/Sidebar.svelte';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import UploadButton from '$lib/browsers/UploadButton.svelte';
  import LibraryBrowser from '$lib/browsers/LibraryBrowser.svelte';
  import NativeLibraryBrowser from '$lib/browsers/NativeLibraryBrowser.svelte';
  import OfflineBrowser from '$lib/browsers/OfflineBrowser.svelte';
  import KeyboardHelp from '$lib/KeyboardHelp.svelte';
  import { isNative } from '$lib/platform';
  import { isLocalServer } from '$lib/constants';
  import { CircleQuestionMark, HardDrive } from 'lucide-svelte';
  import ToastStack from '$lib/ui/ToastStack.svelte';

  const svc = createReaderServices();
  setReaderContext(svc);

  const { state: manga, commands: registry } = svc;
  const native = isNative();
  const chapters = $derived(svc.chapters);
  let helpOpen = $state(false);
  let showDeviceLibrary = $state(false);
  let viewerCommands: ViewerCommands | null = $state(null);
  const activeViewer = $derived(svc.viewers.resolve(manga));

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!manga.selectedChapter) return;
    manga.currentPage; // eslint-disable-line @typescript-eslint/no-unused-expressions
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => svc.saveProgress(), 300);
    return () => clearTimeout(saveTimer);
  });

  const handleDrop = async (e: DragEvent) => {
    const file = e.dataTransfer?.files[0];
    if (!file || !/\.(zip|cbz)$/i.test(file.name)) return;
    try {
      await svc.setSource(new ZipUploadProvider(file));
    } catch (err) {
      alert(`Failed to open file: ${err instanceof Error ? err.message : err}`);
    }
  };

  const isMobile = typeof window !== 'undefined' && 'ontouchstart' in window;

  function enterFullscreen() {
    if (native) return;
    if (isMobile && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  $effect(() => {
    if (native) return;
    if (!manga.selectedChapter && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  });

  $effect(() => {
    if (!manga.selectedChapter) return;
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* ignore */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release();
    };
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
      if (action === 'closeSidebar') {
        event.preventDefault();
        helpOpen = false;
      }
      return;
    }

    event.preventDefault();
    registry.execute(action, { services: svc, viewer: viewerCommands });
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
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => {
    e.preventDefault();
    handleDrop(e);
  }}
/>

<ToastStack />

{#if helpOpen}
  <KeyboardHelp onclose={() => (helpOpen = false)} />
{/if}

{#if chapters.length === 0}
  {#if !native}
    <a
      href="/about"
      class="fixed top-4 right-4 z-10 opacity-40 hover:opacity-80"
      aria-label="How to use"
    >
      <CircleQuestionMark size={24} />
    </a>
  {/if}
  <div
    class="flex min-h-screen flex-col items-center justify-center gap-8 p-8 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]"
  >
    <UploadButton />
    {#if native}
      <OfflineBrowser />
      <LibraryBrowser />
      {#if showDeviceLibrary}
        <NativeLibraryBrowser />
      {:else}
        <button
          class="flex items-center gap-2 border-2 border-white/20 px-4 py-2 text-sm opacity-60 hover:border-white/60 hover:opacity-100"
          onclick={() => (showDeviceLibrary = true)}
        >
          <HardDrive size={16} />
          Browse device
        </button>
      {/if}
      <a href="/settings" class="mt-4 text-sm opacity-40 hover:opacity-80">Settings</a>
    {:else if isLocalServer}
      <OfflineBrowser />
      <LibraryBrowser />
      <a href="/settings" class="mt-4 text-sm opacity-40 hover:opacity-80">Settings</a>
    {:else}
      <OfflineBrowser />
      <div class="flex flex-col items-center gap-3">
        <p class="max-w-sm text-center text-sm opacity-60">
          Run locally to serve manga from your PC to any device on your network
        </p>
        <div class="flex flex-wrap justify-center gap-4">
          <a
            href="/download/konigslibrary.sh"
            download
            class="border-2 border-white/20 px-4 py-2 text-sm whitespace-nowrap hover:border-white/60"
          >
            Linux / Mac
          </a>
          <a
            href="/download/konigslibrary.bat"
            download
            class="border-2 border-white/20 px-4 py-2 text-sm whitespace-nowrap hover:border-white/60"
          >
            Windows
          </a>
          <a
            href="/download/konigslibrary.apk"
            download
            class="border-2 border-white/20 px-4 py-2 text-sm whitespace-nowrap hover:border-white/60"
          >
            Android
          </a>
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div
    class="flex h-dvh select-none md:pl-(--sidebar-peek)"
    onclick={enterFullscreen}
    role="presentation"
  >
    <Sidebar />

    {#if manga.selectedChapter && activeViewer}
      {@const Viewer = activeViewer.component}
      <Viewer bind:commands={viewerCommands} />
    {:else if !manga.selectedChapter}
      <EmptyState>
        <Button size="lg" onclick={() => (manga.sidebarOpen = true)}>Select a chapter</Button>
      </EmptyState>
    {/if}
  </div>
{/if}
