<script lang="ts">
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import type { ViewerCommands } from '$lib/commands';
  import type { createPinchZoomController } from '$lib/utils/pinch-zoom-controller.svelte';
  import { getReaderContext } from '$lib/context';
  import { isNative } from '$lib/utils/platform';
  import { readerActive } from '$lib/ui/reader-active.svelte';
  import ReaderHud from '$lib/ui/ReaderHud.svelte';
  import ReaderTutorial from '$lib/ui/ReaderTutorial.svelte';
  import PinchZoomOverlay from '$lib/viewers/PinchZoomOverlay.svelte';

  let {
    el = $bindable<HTMLDivElement | undefined>(undefined),
    viewerCommands = $bindable<ViewerCommands | null>(null),
    pz
  }: {
    el?: HTMLDivElement;
    viewerCommands?: ViewerCommands | null;
    pz: ReturnType<typeof createPinchZoomController>;
  } = $props();

  const reader = getReaderContext();
  const { state: manga } = reader;
  const native = isNative();

  const activeViewer = $derived(reader.viewers.resolve(manga));

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

  // Show HUD and maybe tutorial on mount (component only mounts when a chapter opens)
  showHud();
  maybeShowTutorial(manga.scrollMode);

  // Show tutorial again if scroll mode changes while reading
  let prevScrollMode = $state(manga.scrollMode);
  $effect(() => {
    if (manga.scrollMode !== prevScrollMode) {
      maybeShowTutorial(manga.scrollMode);
    }
    prevScrollMode = manga.scrollMode;
  });

  $effect(() => {
    readerActive.value = true;
    return () => {
      readerActive.value = false;
    };
  });

  $effect(() => {
    if (!native) return;
    (window as unknown as { __kl?: { setImmersive(h: boolean): void } }).__kl?.setImmersive(
      !hudVisible
    );
  });

  $effect(() => {
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* not supported */
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
</script>

<div
  bind:this={el}
  class="flex h-dvh bg-reader-bg select-none"
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
    active={pz.overlayActive}
    closing={pz.overlayClosing}
    src={pz.overlayImgSrc}
    imgLeft={pz.overlayLeft}
    imgTop={pz.overlayTop}
    imgWidth={pz.overlayWidth}
    imgHeight={pz.overlayHeight}
    scale={pz.scale}
    tx={pz.tx}
    ty={pz.ty}
  />
</div>
