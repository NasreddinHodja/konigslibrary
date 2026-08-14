<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter, usePreloader } from '$lib/chapter-loader';
  import { PAGE_TURN_ZOOM } from '$lib/utils/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import EndOfChapter from '$lib/chapters/EndOfChapter.svelte';

  let { commands = $bindable(), ontap }: { commands?: ViewerCommands | null; ontap?: () => void } =
    $props();

  const reader = getReaderContext();
  const { state: manga } = reader;

  const chapter = useChapter(reader);
  usePreloader(
    manga,
    () => chapter.pageUrls,
    () => chapter.loading,
    () => chapter.decoded,
    chapter.ensurePageUrl ?? undefined
  );

  $effect(() => {
    manga.pageUrls = chapter.pageUrls;
  });

  let showEndScreen = $state(false);
  let pendingEndScreen = false;

  $effect(() => {
    manga.selectedChapter; // eslint-disable-line @typescript-eslint/no-unused-expressions
    if (pendingEndScreen) {
      showEndScreen = true;
      pendingEndScreen = false;
    } else {
      showEndScreen = false;
    }
    if (animTimer) {
      clearTimeout(animTimer);
      animTimer = null;
    }
    pendingDir = 0;
    pinnedNextUrl = null;
    pinnedPrevUrl = null;
    noTrans = true;
    offset = 0;
    requestAnimationFrame(() => {
      noTrans = false;
    });
  });

  const prevUrl = $derived(manga.currentPage > 0 ? chapter.pageUrls[manga.currentPage - 1] : null);
  const currentUrl = $derived(chapter.pageUrls[manga.currentPage] ?? null);
  const nextUrl = $derived(
    manga.currentPage < chapter.pageUrls.length - 1 ? chapter.pageUrls[manga.currentPage + 1] : null
  );

  // Slide animation
  const ANIM_MS = 260;
  let offset = $state(0);
  let noTrans = $state(false);
  let dragging = $state(false);
  let pendingDir = $state<-1 | 1 | 0>(0);
  let animTimer: ReturnType<typeof setTimeout> | null = null;
  // Holds the previous nextUrl/prevUrl for one rAF after commit so whichever
  // side panel ends up centered stays at its already-painted content while
  // the current panel's new <img> paints.
  let pinnedNextUrl: string | null = $state(null);
  let pinnedPrevUrl: string | null = $state(null);

  let containerEl: HTMLDivElement | undefined = $state();
  const getW = () =>
    containerEl?.offsetWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 375);

  const commitNext = () => {
    if (showEndScreen) {
      reader.goToNextChapter();
    } else if (manga.currentPage < chapter.pageUrls.length - 1) {
      manga.currentPage++;
    } else {
      showEndScreen = true;
    }
  };

  const commitPrev = () => {
    if (showEndScreen) {
      showEndScreen = false;
      manga.currentPage = chapter.pageUrls.length - 1;
    } else if (manga.currentPage > 0) {
      manga.currentPage--;
    } else if (reader.getPrevChapter()) {
      pendingEndScreen = true;
      reader.goToPrevChapter();
    }
  };

  const startAnim = (dir: -1 | 1) => {
    pendingDir = dir;
    offset = dir === -1 ? -getW() : getW();
    animTimer = setTimeout(() => {
      animTimer = null;
      if (pendingDir === 0) return;
      const d = pendingDir;
      const savedNext = d === -1 ? nextUrl || null : null;
      const savedPrev = d === 1 ? prevUrl || null : null;
      pendingDir = 0;
      noTrans = true;
      requestAnimationFrame(() => {
        if (d === -1) commitNext();
        else commitPrev();
        // Pin whichever side panel is now centered (next panel going forward,
        // prev panel going back) to its already-painted image for one frame,
        // so it doesn't flash the freshly-recomputed (now-wrong) neighbor page
        // while the current panel's new <img> paints.
        pinnedNextUrl = savedNext;
        pinnedPrevUrl = savedPrev;
        requestAnimationFrame(() => {
          offset = 0;
          requestAnimationFrame(() => {
            pinnedNextUrl = null;
            pinnedPrevUrl = null;
            noTrans = false;
          });
        });
      });
    }, ANIM_MS + 30);
  };

  // Uses setTimeout instead of transitionend to avoid 3x-firing and
  // the "transition + transform applied in same flush = no animation" bug.
  const scheduleCommit = (dir: -1 | 1) => {
    if (animTimer) {
      // Snap current animation to completion, then start fresh for this click.
      clearTimeout(animTimer);
      animTimer = null;
      const d = pendingDir;
      pendingDir = 0;
      noTrans = true;
      pinnedNextUrl = null;
      pinnedPrevUrl = null;
      if (d !== 0) {
        if (d === -1) commitNext();
        else commitPrev();
      }
      offset = 0;
      // noTrans=false must be painted before offset changes, so two rAFs.
      requestAnimationFrame(() => {
        noTrans = false;
        requestAnimationFrame(() => startAnim(dir));
      });
      return;
    }
    startAnim(dir);
  };

  const next = () => {
    if (showEndScreen && !reader.getNextChapter()) return;
    scheduleCommit(-1);
  };

  const prev = () => {
    if (!showEndScreen && manga.currentPage <= 0 && !reader.getPrevChapter()) return;
    scheduleCommit(1);
  };

  // Touch / swipe
  let touchStartX = 0;
  let containerW = 0;
  let maxDrag = 0;

  const onTouchStart = (e: TouchEvent) => {
    if (zoomHeld) return;
    // If a slide animation is in progress, commit it immediately and start fresh.
    if (animTimer) {
      clearTimeout(animTimer);
      animTimer = null;
      if (pendingDir !== 0) {
        const d = pendingDir;
        pendingDir = 0;
        if (d === -1) commitNext();
        else commitPrev();
      }
    }
    noTrans = true;
    pinnedNextUrl = null;
    pinnedPrevUrl = null;
    offset = 0;
    touchStartX = e.touches[0].clientX;
    containerW = getW();
    maxDrag = 0;
    dragging = true;
    // noTrans stays true for one frame, but dragging=true already disables transition
    requestAnimationFrame(() => {
      noTrans = false;
    });
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!dragging) return;
    const dx = e.touches[0].clientX - touchStartX;
    maxDrag = Math.max(maxDrag, Math.abs(dx));
    const noPrev = !showEndScreen && manga.currentPage <= 0 && !reader.getPrevChapter();
    const noNext = showEndScreen && !reader.getNextChapter();
    const rubberLeft = manga.rtl ? noPrev : noNext;
    const rubberRight = manga.rtl ? noNext : noPrev;
    if ((dx < 0 && rubberLeft) || (dx > 0 && rubberRight)) {
      offset = dx * 0.12;
    } else {
      offset = dx;
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!dragging) return;
    // Capture before state changes
    const snapOffset = offset;
    const snapW = containerW;
    dragging = false;
    // Separate "enable transition" (this frame) from "set target offset" (next frame).
    // If both happen in the same flush, the browser applies them atomically and
    // no CSS transition plays.
    requestAnimationFrame(() => {
      const threshold = snapW * 0.22;
      if (snapOffset < -threshold) {
        scheduleCommit(manga.rtl ? 1 : -1);
        offset = -snapW;
      } else if (snapOffset > threshold) {
        scheduleCommit(manga.rtl ? -1 : 1);
        offset = snapW;
      } else {
        offset = 0; // snap back
        if (maxDrag < 10) {
          // Tap: route by x position
          const x = e.changedTouches[0].clientX;
          if (x < snapW * 0.4) {
            if (manga.rtl) next();
            else prev();
          } else if (x > snapW * 0.6) {
            if (manga.rtl) prev();
            else next();
          } else {
            ontap?.();
          }
        }
      }
    });
  };

  // Zoom
  let zoomHeld = $state(false);
  let pageEl: HTMLDivElement | undefined = $state();
  let pageRect: DOMRect | null = $state(null);
  let clientX = $state(0);
  let clientY = $state(0);

  let originX = $derived.by(() => {
    const r = pageRect;
    return r ? ((clientX - r.left) / r.width) * 100 : 50;
  });
  let originY = $derived.by(() => {
    const r = pageRect;
    return r ? ((clientY - r.top) / r.height) * 100 : 50;
  });

  commands = {
    nextPage: next,
    prevPage: prev,
    holdZoom(held: boolean) {
      zoomHeld = held;
      if (held && pageEl) pageRect = pageEl.getBoundingClientRect();
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!zoomHeld) return;
    clientX = e.clientX;
    clientY = e.clientY;
  };

  const handleClickLeft = () => {
    if (zoomHeld) return;
    if (manga.rtl) next();
    else prev();
  };

  const handleClickRight = () => {
    if (zoomHeld) return;
    if (manga.rtl) prev();
    else next();
  };

  const handleClickCenter = () => {
    if (zoomHeld) return;
    ontap?.();
  };

  const transStyle = $derived(
    noTrans || dragging ? 'none' : `transform ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
  );
</script>

<div
  bind:this={containerEl}
  class="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-reader-bg select-none"
  style="padding-bottom: calc(var(--safe-bottom) - var(--safe-top))"
  onmousemove={handleMouseMove}
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  role="region"
  aria-label={showEndScreen
    ? 'End of chapter'
    : `Page ${manga.currentPage + 1} of ${chapter.pageUrls.length}`}
>
  {#if chapter.loading}
    <Loader />
  {:else if chapter.error}
    <p class="py-8 text-center text-sm opacity-60">Failed to load chapter: {chapter.error}</p>
  {:else}
    <!-- Prev panel -->
    <div
      class="absolute inset-0 flex items-center justify-center"
      style:transform="translateX(calc(-100% + {offset}px))"
      style:transition={transStyle}
      style:will-change="transform"
      aria-hidden="true"
    >
      {#if pinnedPrevUrl}
        <img src={pinnedPrevUrl} alt="Previous page" class="max-h-full max-w-full object-contain" />
      {:else if showEndScreen}
        {#if chapter.pageUrls[chapter.pageUrls.length - 1]}
          <img
            src={chapter.pageUrls[chapter.pageUrls.length - 1]}
            alt="Last page"
            class="max-h-full max-w-full object-contain"
          />
        {/if}
      {:else if prevUrl}
        <img src={prevUrl} alt="Previous page" class="max-h-full max-w-full object-contain" />
      {/if}
    </div>

    <!-- Current panel -->
    <div
      class="absolute inset-0 flex items-center justify-center"
      style:transform="translateX({offset}px)"
      style:transition={transStyle}
      style:will-change="transform"
    >
      {#if showEndScreen}
        <EndOfChapter />
      {:else}
        <div
          bind:this={pageEl}
          class="flex h-full w-full items-center justify-center"
          style:transform={zoomHeld ? `scale(${PAGE_TURN_ZOOM})` : undefined}
          style:transform-origin="{originX}% {originY}%"
          style:transition={zoomHeld ? 'none' : 'transform 0.15s ease-out'}
        >
          {#if currentUrl}
            <img
              src={currentUrl}
              alt="Page {manga.currentPage + 1} of {chapter.pageUrls.length}"
              class="max-h-full max-w-full object-contain"
            />
          {/if}
        </div>
      {/if}
    </div>

    <!-- Next panel -->
    <div
      class="absolute inset-0 flex items-center justify-center"
      style:transform="translateX(calc(100% + {offset}px))"
      style:transition={transStyle}
      style:will-change="transform"
      aria-hidden="true"
    >
      {#if pinnedNextUrl}
        <img src={pinnedNextUrl} alt="Next page" class="max-h-full max-w-full object-contain" />
      {:else if !showEndScreen && manga.currentPage >= chapter.pageUrls.length - 1}
        <EndOfChapter />
      {:else if nextUrl}
        <img src={nextUrl} alt="Next page" class="max-h-full max-w-full object-contain" />
      {/if}
    </div>
  {/if}

  <!-- Click zones: hidden on end screen so its buttons remain interactive -->
  {#if !showEndScreen}
    <div
      role="button"
      tabindex="0"
      class="absolute inset-y-0 left-0 z-10 w-[40%]"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-w-resize={!zoomHeld}
      aria-label="Previous page"
      onpointerup={(e) => {
        if (e.pointerType !== 'mouse') return;
        handleClickLeft();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClickLeft();
      }}
    ></div>

    <div
      role="button"
      tabindex="0"
      class="absolute inset-y-0 left-[40%] z-10 w-[20%]"
      class:cursor-zoom-in={zoomHeld}
      aria-label="Toggle menu"
      onpointerup={(e) => {
        if (e.pointerType !== 'mouse') return;
        handleClickCenter();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClickCenter();
      }}
    ></div>

    <div
      role="button"
      tabindex="0"
      class="absolute inset-y-0 right-0 z-10 w-[40%]"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-e-resize={!zoomHeld}
      aria-label="Next page"
      onpointerup={(e) => {
        if (e.pointerType !== 'mouse') return;
        handleClickRight();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClickRight();
      }}
    ></div>
  {/if}
</div>
