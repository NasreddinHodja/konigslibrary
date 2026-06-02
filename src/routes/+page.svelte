<script lang="ts">
  import { fade } from 'svelte/transition';
  import { flushSync } from 'svelte';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import { ZipUploadProvider } from '$lib/sources';
  import { resolveKey } from '$lib/keyboard/keybindings.svelte';
  import type { ViewerCommands } from '$lib/commands';
  import { createReaderServices, setReaderContext } from '$lib/context';
  import ReaderHud from '$lib/ui/ReaderHud.svelte';
  import PinchZoomOverlay from '$lib/viewers/PinchZoomOverlay.svelte';
  import { createPinchZoom } from '$lib/utils/pinch-zoom.svelte';
  import MangaDetail from '$lib/ui/MangaDetail.svelte';
  import UploadButton from '$lib/browsers/UploadButton.svelte';
  import LibraryBrowser from '$lib/browsers/LibraryBrowser.svelte';
  import NativeLibraryBrowser from '$lib/browsers/NativeLibraryBrowser.svelte';
  import OfflineBrowser from '$lib/browsers/OfflineBrowser.svelte';
  import KeyboardHelp from '$lib/keyboard/KeyboardHelp.svelte';
  import { isNative } from '$lib/utils/platform';
  import { isLocalServer } from '$lib/utils/constants';
  import { pushState } from '$app/navigation';
  import { CircleQuestionMark, Settings } from 'lucide-svelte';
  import ToastStack from '$lib/ui/ToastStack.svelte';
  import ReaderTutorial from '$lib/ui/ReaderTutorial.svelte';
  import UpdateBanner from '$lib/ui/UpdateBanner.svelte';
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

  let readerEl: HTMLDivElement | undefined = $state();

  const pinch = createPinchZoom();
  let overlayActive = $state(false);
  let overlayClosing = $state(false);
  let overlaySourceImg: HTMLImageElement | null = null;
  let overlayCloseTimer: ReturnType<typeof setTimeout> | null = null;

  function deactivateOverlay() {
    if (overlayCloseTimer) {
      clearTimeout(overlayCloseTimer);
      overlayCloseTimer = null;
    }
    if (overlaySourceImg) {
      overlaySourceImg.style.opacity = '';
      overlaySourceImg = null;
    }
    overlayActive = false;
    overlayClosing = false;
    pinch.reset();
  }

  function startClosingAnimation() {
    if (overlayCloseTimer) {
      clearTimeout(overlayCloseTimer);
      overlayCloseTimer = null;
    }
    // Install the transform transition synchronously — flushSync guarantees Svelte
    // writes it to the DOM before the rAF fires, so the CSS engine registers it first.
    flushSync(() => {
      overlayClosing = true;
    });
    requestAnimationFrame(() => {
      // Transition is now in computed styles; changing scale triggers the animation.
      pinch.reset(); // scale→1, tx/ty→0, animates via 'transform 0.2s ease-out'
      overlayCloseTimer = setTimeout(() => {
        overlayCloseTimer = null;
        // Overlay is now at scale=1, pixel-aligned with source — instant swap is invisible.
        if (overlaySourceImg) {
          overlaySourceImg.style.opacity = '';
          overlaySourceImg = null;
        }
        overlayActive = false;
        overlayClosing = false;
      }, 140);
    });
  }
  let overlayImgSrc = $state('');
  let overlayLeft = $state(0);
  let overlayTop = $state(0);
  let overlayWidth = $state(0);
  let overlayHeight = $state(0);

  $effect(() => {
    if (!readerEl || manga.selectedChapter === null) return;

    let _imgRect: { left: number; top: number; width: number; height: number } | null = null;
    let _touchCount = 0;
    let _tapStartX = 0;
    let _tapStartY = 0;
    let _tapMoved = false;

    function handleTouchStart(e: TouchEvent) {
      if (overlayClosing) {
        // A new pinch during close animation cancels it and re-enters zoom
        if (e.touches.length >= 2) {
          if (overlayCloseTimer) {
            clearTimeout(overlayCloseTimer);
            overlayCloseTimer = null;
          }
          overlayClosing = false;
        } else {
          // Single tap during close — let the animation finish
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }
      if (overlayActive) {
        if (e.touches.length >= 2) {
          _touchCount = Math.max(_touchCount, e.touches.length);
          _tapMoved = true;
        } else if (e.touches.length === 1) {
          _touchCount = 1;
          _tapMoved = false;
          _tapStartX = e.touches[0].clientX;
          _tapStartY = e.touches[0].clientY;
        }
        const consumed = pinch.onTouchStart(e, _imgRect!);
        if (consumed || pinch.active) {
          e.stopPropagation();
          e.preventDefault();
        } else {
          // Scale is 1, single finger: deactivate and let viewer handle
          deactivateOverlay();
        }
        return;
      }

      if (e.touches.length < 2) return;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const els = document.elementsFromPoint(midX, midY);
      const img = els.find((el) => el.tagName === 'IMG') as HTMLImageElement | undefined;
      if (!img?.src) return;

      const rect = img.getBoundingClientRect();
      _imgRect = rect;
      _touchCount = 2;
      _tapMoved = true;

      overlaySourceImg = img;
      img.style.opacity = '0';
      overlayImgSrc = img.src;
      overlayLeft = rect.left;
      overlayTop = rect.top;
      overlayWidth = rect.width;
      overlayHeight = rect.height;
      overlayActive = true;

      pinch.onTouchStart(e, rect);
      e.stopPropagation();
      e.preventDefault();
    }

    function handleTouchMove(e: TouchEvent) {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - _tapStartX;
        const dy = e.touches[0].clientY - _tapStartY;
        if (dx * dx + dy * dy > 100) _tapMoved = true;
      }
      if (!overlayActive) return;
      pinch.onTouchMove(e);
      e.stopPropagation();
      e.preventDefault();
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!overlayActive) return;
      e.stopPropagation();

      if (e.touches.length > 0) {
        // Finger count changed but not all lifted yet
        _touchCount = Math.max(_touchCount, e.touches.length + e.changedTouches.length);
        pinch.onTouchEnd(e);
        return;
      }

      // All fingers lifted
      pinch.onTouchEnd(e);

      if (!pinch.active) {
        // Pinched back to 1× or was never zoomed — animate close
        startClosingAnimation();
        return;
      }

      // Still zoomed: tap-to-close
      if (_touchCount === 1 && !_tapMoved) {
        startClosingAnimation();
        return;
      }

      _touchCount = 0;
    }

    readerEl.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
    readerEl.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    readerEl.addEventListener('touchend', handleTouchEnd, { capture: true });
    readerEl.addEventListener('touchcancel', handleTouchEnd, { capture: true });

    return () => {
      readerEl!.removeEventListener('touchstart', handleTouchStart, { capture: true });
      readerEl!.removeEventListener('touchmove', handleTouchMove, { capture: true });
      readerEl!.removeEventListener('touchend', handleTouchEnd, { capture: true });
      readerEl!.removeEventListener('touchcancel', handleTouchEnd, { capture: true });
    };
  });

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

  $effect(() => {
    if (!native) return;
    const hidden = manga.selectedChapter !== null && !hudVisible;
    (window as unknown as { __kl?: { setImmersive(h: boolean): void } }).__kl?.setImmersive(hidden);
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
      if (overlayActive) {
        deactivateOverlay();
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
        svc.clearManga();
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
        svc.clearManga();
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
        <a
          href="/settings"
          class="flex items-center gap-1.5 text-xs tracking-widest opacity-20 hover:opacity-60"
          ><Settings size={12} />SETTINGS</a
        >
      {:else if isLocalServer}
        <div class="w-full max-w-lg space-y-8">
          <OfflineBrowser />
          <LibraryBrowser />
        </div>
        <a
          href="/settings"
          class="flex items-center gap-1.5 text-xs tracking-widest opacity-20 hover:opacity-60"
          ><Settings size={12} />SETTINGS</a
        >
      {:else}
        <div class="w-full max-w-lg space-y-10">
          <OfflineBrowser />

          <div class="border-t border-fg/10 pt-8">
            <p class="mb-1 text-xs font-bold tracking-widest opacity-30">RUN LOCALLY</p>
            <p class="mb-5 text-sm opacity-40">
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
  <div
    bind:this={readerEl}
    class="flex h-dvh select-none"
    role="presentation"
    out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
    in:fade={{ duration: ANIM_DURATION, delay: ANIM_EXIT_DURATION, easing: ANIM_EASE }}
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

    <PinchZoomOverlay
      active={overlayActive}
      closing={overlayClosing}
      src={overlayImgSrc}
      imgLeft={overlayLeft}
      imgTop={overlayTop}
      imgWidth={overlayWidth}
      imgHeight={overlayHeight}
      scale={pinch.scale}
      tx={pinch.tx}
      ty={pinch.ty}
    />
  </div>
{/if}
