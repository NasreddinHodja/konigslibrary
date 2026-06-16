import { flushSync } from 'svelte';
import { createPinchZoom } from './pinch-zoom.svelte';

export function createPinchZoomController(
  getReaderEl: () => HTMLDivElement | undefined,
  getSelectedChapter: () => string | null
) {
  const pinch = createPinchZoom();
  let overlayActive = $state(false);
  let overlayClosing = $state(false);
  let overlaySourceImg: HTMLImageElement | null = null;
  let overlayCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let overlayImgSrc = $state('');
  let overlayLeft = $state(0);
  let overlayTop = $state(0);
  let overlayWidth = $state(0);
  let overlayHeight = $state(0);

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

  $effect(() => {
    const readerEl = getReaderEl();
    if (!readerEl || getSelectedChapter() === null) return;

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
      readerEl.removeEventListener('touchstart', handleTouchStart, { capture: true });
      readerEl.removeEventListener('touchmove', handleTouchMove, { capture: true });
      readerEl.removeEventListener('touchend', handleTouchEnd, { capture: true });
      readerEl.removeEventListener('touchcancel', handleTouchEnd, { capture: true });
    };
  });

  return {
    get overlayActive() {
      return overlayActive;
    },
    get overlayClosing() {
      return overlayClosing;
    },
    get overlayImgSrc() {
      return overlayImgSrc;
    },
    get overlayLeft() {
      return overlayLeft;
    },
    get overlayTop() {
      return overlayTop;
    },
    get overlayWidth() {
      return overlayWidth;
    },
    get overlayHeight() {
      return overlayHeight;
    },
    get scale() {
      return pinch.scale;
    },
    get tx() {
      return pinch.tx;
    },
    get ty() {
      return pinch.ty;
    },
    deactivateOverlay
  };
}
