<script lang="ts">
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
  import { ZipUploadProvider } from '$lib/sources';
  import { resolveKey } from '$lib/keyboard/keybindings.svelte';
  import type { ViewerCommands } from '$lib/commands';
  import { createReaderServices, setReaderContext } from '$lib/context';
  import ReaderHud from '$lib/ui/ReaderHud.svelte';
  import MangaDetail from '$lib/ui/MangaDetail.svelte';
  import UploadButton from '$lib/browsers/UploadButton.svelte';
  import LibraryBrowser from '$lib/browsers/LibraryBrowser.svelte';
  import NativeLibraryBrowser from '$lib/browsers/NativeLibraryBrowser.svelte';
  import OfflineBrowser from '$lib/browsers/OfflineBrowser.svelte';
  import KeyboardHelp from '$lib/keyboard/KeyboardHelp.svelte';
  import { isNative } from '$lib/utils/platform';
  import { invoke } from '@tauri-apps/api/core';
  import { isLocalServer } from '$lib/utils/constants';
  import { pushState } from '$app/navigation';
  import { CircleQuestionMark, Settings } from 'lucide-svelte';
  import ToastStack from '$lib/ui/ToastStack.svelte';
  import ReaderTutorial from '$lib/ui/ReaderTutorial.svelte';
  import { showError } from '$lib/ui/toast.svelte';

  const svc = createReaderServices();
  setReaderContext(svc);

  const { state: manga, commands: registry } = svc;
  const native = isNative();
  const chapters = $derived(svc.chapters);
  let helpOpen = $state(false);
  let viewerCommands: ViewerCommands | null = $state(null);
  const activeViewer = $derived(svc.viewers.resolve(manga));

  let dragCount = $state(0);
  const isDragOver = $derived(dragCount > 0 && chapters.length === 0);

  const TUTORIAL_PAGETURN_KEY = 'kl:tutorial:pageTurn';
  const TUTORIAL_SCROLL_KEY = 'kl:tutorial:scroll';
  let tutorialVisible = $state(false);

  function maybeShowTutorial(scrollMode: boolean) {
    const key = scrollMode ? TUTORIAL_SCROLL_KEY : TUTORIAL_PAGETURN_KEY;
    if (!localStorage.getItem(key)) {
      tutorialVisible = true;
      localStorage.setItem(key, '1');
    }
  }

  let hudVisible = $state(false);
  let hudTimer: ReturnType<typeof setTimeout> | undefined;

  function showHud() {
    hudVisible = true;
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      hudVisible = false;
    }, 3000);
  }

  function hideHud() {
    hudVisible = false;
    clearTimeout(hudTimer);
  }

  function toggleHud() {
    if (hudVisible) hideHud();
    else showHud();
  }

  let prevSelectedChapter = $state<string | null>(null);
  let prevScrollMode = $state(manga.scrollMode);
  $effect(() => {
    if (manga.selectedChapter !== null && prevSelectedChapter === null) {
      showHud();
      maybeShowTutorial(manga.scrollMode);
    } else if (manga.selectedChapter !== null && manga.scrollMode !== prevScrollMode) {
      maybeShowTutorial(manga.scrollMode);
    }
    prevSelectedChapter = manga.selectedChapter;
    prevScrollMode = manga.scrollMode;
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (manga.selectedChapter === null) return;
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
      showError(`Failed to open file: ${err instanceof Error ? err.message : err}`);
    }
  };

  const isMobile = typeof window !== 'undefined' && 'ontouchstart' in window;

  $effect(() => {
    if (!native) return;
    invoke('plugin:immersive|setImmersive', { hidden: manga.selectedChapter !== null }).catch(
      () => {}
    );
  });

  $effect(() => {
    if (manga.selectedChapter === null) return;
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* wake lock not supported */
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

  $effect(() => {
    if (chapters.length === 0) return;

    pushState('', { kl: 'reader' });

    const onPopState = () => {
      if (helpOpen) {
        helpOpen = false;
        pushState('', { kl: 'reader' });
      } else if (manga.selectedChapter !== null) {
        manga.selectedChapter = null;
        pushState('', { kl: 'reader' });
      } else {
        svc.clearManga();
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
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

<ToastStack />

{#if helpOpen}
  <KeyboardHelp onclose={() => (helpOpen = false)} />
{/if}

{#if chapters.length === 0}
  <div
    class="flex min-h-screen flex-col"
    out:fade={{ duration: Math.round(ANIM_DURATION * 0.5), easing: ANIM_EASE }}
    in:fade={{ duration: ANIM_DURATION, delay: Math.round(ANIM_DURATION * 0.5), easing: ANIM_EASE }}
  >
    {#if !native}
      <a
        href="/about"
        class="fixed z-10 opacity-30 hover:opacity-80"
        style="top: calc(1rem + var(--safe-top)); right: calc(1rem + var(--safe-right))"
        aria-label="How to use"
      >
        <CircleQuestionMark size={18} />
      </a>
    {/if}

    <!-- Main content -->
    <div
      class="flex flex-1 flex-col items-center gap-10 px-6 py-16"
      style="padding-top: calc(4rem + var(--safe-top)); padding-bottom: calc(2.5rem + var(--safe-bottom))"
    >
      <h1 class="text-4xl font-bold tracking-widest opacity-90">KONIGSLIBRARY</h1>
      <UploadButton {isDragOver} />
      {#if native}
        <div class="w-full max-w-lg space-y-8">
          <OfflineBrowser />
          <LibraryBrowser />
          <NativeLibraryBrowser />
        </div>
        <a href="/settings" class="flex items-center gap-1.5 text-xs tracking-widest opacity-20 hover:opacity-60"><Settings size={12} />SETTINGS</a>
      {:else if isLocalServer}
        <div class="w-full max-w-lg space-y-8">
          <OfflineBrowser />
          <LibraryBrowser />
        </div>
        <a href="/settings" class="flex items-center gap-1.5 text-xs tracking-widest opacity-20 hover:opacity-60"><Settings size={12} />SETTINGS</a>
      {:else}
        <div class="w-full max-w-lg space-y-10">
          <OfflineBrowser />

          <div class="border-t border-white/10 pt-8">
            <p class="mb-1 text-xs font-bold tracking-widest opacity-30">RUN LOCALLY</p>
            <p class="mb-5 text-sm opacity-40">
              Serve manga from your PC to any device on your network.
            </p>
            <div class="flex flex-wrap gap-3">
              <a
                href="/download/konigslibrary.sh"
                download
                class="border-2 border-white/30 px-4 py-2 text-sm hover:border-white hover:bg-white/10"
              >
                Linux / Mac
              </a>
              <a
                href="/download/konigslibrary.bat"
                download
                class="border-2 border-white/30 px-4 py-2 text-sm hover:border-white hover:bg-white/10"
              >
                Windows
              </a>
              <a
                href="/download/konigslibrary.apk"
                download
                class="border-2 border-white/30 px-4 py-2 text-sm hover:border-white hover:bg-white/10"
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
    out:fade={{ duration: Math.round(ANIM_DURATION * 0.5), easing: ANIM_EASE }}
    in:fade={{ duration: ANIM_DURATION, delay: Math.round(ANIM_DURATION * 0.5), easing: ANIM_EASE }}
  >
    <MangaDetail />
  </div>
{:else}
  <div
    class="flex h-dvh select-none"
    role="presentation"
    out:fade={{ duration: Math.round(ANIM_DURATION * 0.5), easing: ANIM_EASE }}
    in:fade={{ duration: ANIM_DURATION, delay: Math.round(ANIM_DURATION * 0.5), easing: ANIM_EASE }}
  >
    {#if activeViewer}
      {@const Viewer = activeViewer.component}
      <Viewer bind:commands={viewerCommands} ontap={toggleHud} />
    {/if}

    <ReaderHud
      visible={hudVisible}
      onback={() => {
        hideHud();
        manga.selectedChapter = null;
      }}
    />

    {#if tutorialVisible}
      <ReaderTutorial ondismiss={() => (tutorialVisible = false)} />
    {/if}
  </div>
{/if}
