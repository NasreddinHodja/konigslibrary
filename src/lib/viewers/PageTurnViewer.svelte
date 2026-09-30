<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import type { ViewerCommands } from '$lib/commands';
  import { useChapter, usePreloader } from '$lib/chapter-loader';
  import { PAGE_TURN_ZOOM } from '$lib/utils/constants';
  import Loader from '$lib/ui/Loader.svelte';
  import EndOfChapter from '$lib/chapters/EndOfChapter.svelte';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';

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
    stop();
    onSettle = null;
    velocity = 0;
    location = previous = target = offset = 0;
  });

  const pageCount = $derived(chapter.pageUrls.length);
  // Pages sit at 0..pageCount-1 and the end-of-chapter screen at pageCount.
  const cur = $derived(showEndScreen ? pageCount : manga.currentPage);
  const dirSign = $derived(manga.rtl ? -1 : 1);

  // Panels around the current page, keyed so a turn moves the same DOM node
  // into the centre instead of swapping an <img> src (which would flash while
  // decoding). Two on each side so rapid turns never uncover an empty slot.
  const panels = $derived.by(() => {
    const out: { key: string; slot: number; url: string | null }[] = [];
    for (let slot = -2; slot <= 2; slot++) {
      const idx = cur + slot;
      if (idx < 0 || idx > pageCount) continue;
      if (idx === pageCount) out.push({ key: 'end', slot, url: null });
      else
        out.push({
          key: `${manga.selectedChapter}:${idx}`,
          slot,
          url: chapter.pageUrls[idx] ?? null
        });
    }
    return out;
  });

  let containerEl: HTMLDivElement | undefined = $state();
  const getW = () =>
    containerEl?.offsetWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 375);

  const canNext = () => !(showEndScreen && !reader.getNextChapter());
  const canPrev = () => !(!showEndScreen && manga.currentPage <= 0 && !reader.getPrevChapter());

  const commitNext = () => {
    if (showEndScreen) {
      reader.goToNextChapter();
    } else if (manga.currentPage < pageCount - 1) {
      manga.currentPage++;
    } else {
      showEndScreen = true;
    }
  };

  const commitPrev = () => {
    if (showEndScreen) {
      showEndScreen = false;
      manga.currentPage = pageCount - 1;
    } else if (manga.currentPage > 0) {
      manga.currentPage--;
    } else if (reader.getPrevChapter()) {
      pendingEndScreen = true;
      reader.goToPrevChapter();
    }
  };

  // Motion copied from Embla Carousel's source: a fixed-timestep integrator
  // (ScrollBody + Animations), release velocity measured over the last 170ms
  // (DragTracker), and flick/snap selection on release (DragHandler). Values
  // are Embla's touch defaults, except BASE_DURATION: Embla's 25 takes ~380ms
  // to cover 90% of a page turn, 18 takes ~270ms with no visible overshoot.
  const STEP_MS = 1000 / 60;
  const BASE_DURATION = 18;
  const BASE_FRICTION = 0.68;
  const FORCE_BOOST = 400;
  const LOG_INTERVAL = 170;
  const DRAG_THRESHOLD = 10;
  const SETTLE_PX = 0.1;
  const OVERSHOOT_PX = 1;
  /// How much a strong flick shortens the settle. Embla's 25 - 10 * force is
  /// 0.4; higher lets fast swipes finish faster, only safe with the overshoot cap.
  const FLICK_SPEEDUP = 0.6;
  const RUBBER = 0.12;
  /// Width of each side's tap-to-turn zone, as a fraction of the screen; the
  /// middle toggles the menu.
  const TAP_ZONE = 0.15;

  /// Horizontal shift of the whole strip in px, as rendered.
  let offset = $state(0);
  let location = 0;
  let previous = 0;
  let target = 0;
  let velocity = 0;
  let duration = BASE_DURATION;
  let friction = BASE_FRICTION;
  let rafId = 0;
  let lastTs: number | null = null;
  let accumulated = 0;
  /// Commit deferred to the end of the slide, for turns that change chapter.
  let onSettle: (() => void) | null = null;

  function seek() {
    previous = location;
    if (!duration) {
      velocity = 0;
      location = target;
      return;
    }
    const displacement = target - location;
    velocity += displacement / duration;
    velocity *= friction;
    location += velocity;
    // Not in Embla: a fast flick's carried speed would spring well past the
    // page before bouncing back, so the overshoot is capped to a small bounce.
    const dir = Math.sign(displacement);
    if ((location - target) * dir > OVERSHOOT_PX) {
      location = target + dir * OVERSHOOT_PX;
      velocity = 0;
    }
  }

  function frame(ts: number) {
    if (lastTs === null) {
      lastTs = ts;
      seek();
      seek();
    }
    // Capped so a frame after the webview was backgrounded doesn't jump.
    accumulated += Math.min(ts - lastTs, 100);
    lastTs = ts;
    while (accumulated >= STEP_MS) {
      seek();
      accumulated -= STEP_MS;
    }
    const alpha = accumulated / STEP_MS;
    offset = location * alpha + previous * (1 - alpha);

    if (Math.abs(target - offset) < SETTLE_PX) {
      stop();
      velocity = 0;
      location = previous = offset = target;
      const cb = onSettle;
      onSettle = null;
      cb?.();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTs = null;
    accumulated = 0;
  }

  function animateTo(to: number, dur = BASE_DURATION, fric = BASE_FRICTION) {
    target = to;
    duration = dur;
    friction = fric;
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  /// Moves the strip's origin by `shift` without moving anything on screen.
  function rebase(shift: number) {
    location += shift;
    previous += shift;
    offset += shift;
    // Beyond two pages out the far panel isn't rendered; clamp rather than
    // uncover it.
    const limit = 2 * getW();
    const excess = Math.abs(location) - limit;
    if (excess > 0) {
      const back = Math.sign(location) * excess;
      location -= back;
      previous -= back;
      offset -= back;
    }
  }

  /// Runs a chapter-changing commit now instead of at the end of its slide.
  function flush() {
    if (!onSettle) return;
    const cb = onSettle;
    onSettle = null;
    stop();
    cb();
  }

  /// `step` is in reading order: 1 = next page, -1 = previous.
  function turn(step: 1 | -1, dur = BASE_DURATION, fric = BASE_FRICTION) {
    flush();
    const shift = step * dirSign * getW();
    const crossesChapter = step === 1 ? cur === pageCount : cur === 0;
    if (crossesChapter) {
      // The next chapter isn't loaded yet: slide out, then switch.
      onSettle = step === 1 ? commitNext : commitPrev;
      animateTo(-shift, dur, fric);
      return;
    }
    // Commit up front so the page counter updates immediately; the rebase
    // keeps the incoming page exactly where it is on screen.
    if (step === 1) commitNext();
    else commitPrev();
    rebase(shift);
    animateTo(0, dur, fric);
  }

  const next = () => {
    if (canNext()) turn(1);
  };

  const prev = () => {
    if (canPrev()) turn(-1);
  };

  // Touch
  let tracking = false;
  let axisDecided = false;
  let startX = 0;
  let startY = 0;
  let startLocation = 0;
  let maxDrag = 0;
  let trackStart = { x: 0, t: 0 };
  let trackLast = { x: 0, t: 0 };

  const onTouchStart = (e: TouchEvent) => {
    if (zoomHeld || e.touches.length > 1) return;
    flush();
    stop();
    target = location;
    velocity = 0;
    previous = offset = location;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startLocation = location;
    maxDrag = 0;
    axisDecided = false;
    tracking = true;
    trackStart = trackLast = { x: t.clientX, t: e.timeStamp };
  };

  /// Ends a drag without turning, easing back to the current page.
  const cancelDrag = () => {
    tracking = false;
    animateTo(0);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!tracking) return;
    if (e.touches.length >= 2) return cancelDrag();
    const t = e.touches[0];
    const dx = t.clientX - startX;
    if (!axisDecided) {
      // Embla's axis lock: the first move decides, and a mostly vertical
      // gesture never drags the page.
      axisDecided = true;
      if (Math.abs(dx) <= Math.abs(t.clientY - startY)) return cancelDrag();
    }
    const expired = e.timeStamp - trackStart.t > LOG_INTERVAL;
    trackLast = { x: t.clientX, t: e.timeStamp };
    if (expired) trackStart = trackLast;
    maxDrag = Math.max(maxDrag, Math.abs(dx));

    let loc = startLocation + dx;
    // Moving the strip left brings in the panel on the right, which is the
    // next page in LTR and the previous one in RTL.
    const blockedLeft = manga.rtl ? !canPrev() : !canNext();
    const blockedRight = manga.rtl ? !canNext() : !canPrev();
    if ((loc < 0 && blockedLeft) || (loc > 0 && blockedRight)) loc *= RUBBER;
    location = previous = offset = loc;
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    const W = getW();

    if (maxDrag < DRAG_THRESHOLD) {
      animateTo(0);
      const x = e.changedTouches[0].clientX;
      if (x < W * TAP_ZONE) {
        if (manga.rtl) next();
        else prev();
      } else if (x > W * (1 - TAP_ZONE)) {
        if (manga.rtl) prev();
        else next();
      } else {
        ontap?.();
      }
      return;
    }

    // DragTracker.pointerUp: only a recent, fast enough movement is a flick.
    const diffTime = e.timeStamp - trackStart.t;
    const expired = e.timeStamp - trackLast.t > LOG_INTERVAL;
    const speed = diffTime ? (trackLast.x - trackStart.x) / diffTime : 0;
    const isFlick = diffTime && !expired && Math.abs(speed) > 0.1;
    const fingerSpeed = isFlick ? speed : 0;

    // DragHandler.up: a strong flick always goes one page; otherwise snap to
    // wherever the flick would have carried the strip.
    const rawForce = fingerSpeed * FORCE_BOOST;
    const flickThreshold = Math.min(225, Math.max(50, W * 0.2));
    let screenDir = 0;
    if (Math.abs(rawForce) >= flickThreshold) {
      screenDir = Math.sign(rawForce);
    } else {
      const projected = location + rawForce;
      if (Math.abs(projected) > W / 2) screenDir = Math.sign(projected);
    }
    let step = (-screenDir * dirSign) as -1 | 0 | 1;
    if ((step === 1 && !canNext()) || (step === -1 && !canPrev())) step = 0;

    const force = (step === 0 ? 0 : -step * dirSign * W) - location;
    const forceFactor = factorAbs(rawForce, force);
    const dur = BASE_DURATION * (1 - FLICK_SPEEDUP * forceFactor);
    const fric = BASE_FRICTION + forceFactor / 50;
    // Carry the finger's speed into the release so it doesn't stall, but not
    // speed away from the destination, which only overshoots and bounces.
    velocity = Math.sign(fingerSpeed) === Math.sign(force) ? fingerSpeed * STEP_MS : 0;

    if (step === 0) animateTo(0, dur, fric);
    else turn(step, dur, fric);
  };

  function factorAbs(b: number, a: number): number {
    if (b === 0 || a === 0) return 0;
    if (Math.abs(b) <= Math.abs(a)) return 0;
    return Math.abs((Math.abs(b) - Math.abs(a)) / b);
  }

  // Zoom
  let zoomHeld = $state(false);
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
      const pageEl = containerEl?.querySelector('[data-current] [data-page]');
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

  $effect(() => stop);
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
  aria-label={showEndScreen ? 'End of chapter' : `Page ${manga.currentPage + 1} of ${pageCount}`}
>
  {#if chapter.loading}
    <Loader />
  {:else if chapter.error}
    <p class="py-8 text-center text-sm opacity-60">Failed to load chapter: {chapter.error}</p>
  {:else}
    {#each panels as panel (panel.key)}
      <div
        class="absolute inset-0 flex items-center justify-center"
        style:transform="translateX(calc({panel.slot * dirSign * 100}% + {offset}px))"
        style:will-change="transform"
        aria-hidden={panel.slot !== 0}
        inert={panel.slot !== 0}
        data-current={panel.slot === 0 || undefined}
      >
        {#if panel.key === 'end'}
          <EndOfChapter />
        {:else}
          <div
            data-page
            class="flex h-full w-full items-center justify-center"
            style:transform={zoomHeld && panel.slot === 0 ? `scale(${PAGE_TURN_ZOOM})` : undefined}
            style:transform-origin="{originX}% {originY}%"
            style:transition={zoomHeld ? 'none' : 'transform 0.15s ease-out'}
          >
            {#if panel.url}
              <img
                src={panel.url}
                alt="Page {cur + panel.slot + 1} of {pageCount}"
                class="max-h-full max-w-full object-contain"
              />
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {/if}

  <!-- Hover-only (Tailwind's hover variants skip touch screens), so it shows
       with a mouse and never sticks after a tap. -->
  {#snippet arrow(Icon: typeof ChevronLeft)}
    <div
      class="pointer-events-none mx-3 flex h-12 w-12 items-center justify-center bg-bg/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
    >
      <Icon size={24} />
    </div>
  {/snippet}

  <!-- Click zones: hidden on end screen so its buttons remain interactive -->
  {#if !showEndScreen}
    <div
      role="button"
      tabindex="0"
      class="group absolute inset-y-0 left-0 z-10 flex items-center justify-start"
      style:width="{TAP_ZONE * 100}%"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-w-resize={!zoomHeld}
      aria-label="Previous page"
      onpointerdown={(e) => {
        if (e.pointerType === 'mouse') e.preventDefault();
      }}
      onpointerup={(e) => {
        if (e.pointerType !== 'mouse') return;
        handleClickLeft();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClickLeft();
      }}
    >
      {#if !zoomHeld && (manga.rtl ? canNext() : canPrev())}
        {@render arrow(ChevronLeft)}
      {/if}
    </div>

    <div
      role="button"
      tabindex="0"
      class="absolute inset-y-0 z-10"
      style:left="{TAP_ZONE * 100}%"
      style:right="{TAP_ZONE * 100}%"
      class:cursor-zoom-in={zoomHeld}
      aria-label="Toggle menu"
      onpointerdown={(e) => {
        if (e.pointerType === 'mouse') e.preventDefault();
      }}
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
      class="group absolute inset-y-0 right-0 z-10 flex items-center justify-end"
      style:width="{TAP_ZONE * 100}%"
      class:cursor-zoom-in={zoomHeld}
      class:cursor-e-resize={!zoomHeld}
      aria-label="Next page"
      onpointerdown={(e) => {
        if (e.pointerType === 'mouse') e.preventDefault();
      }}
      onpointerup={(e) => {
        if (e.pointerType !== 'mouse') return;
        handleClickRight();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClickRight();
      }}
    >
      {#if !zoomHeld && (manga.rtl ? canPrev() : canNext())}
        {@render arrow(ChevronRight)}
      {/if}
    </div>
  {/if}
</div>
