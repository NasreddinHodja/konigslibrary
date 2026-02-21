import {
  DRAWER_EDGE_ZONE,
  SWIPE_MAX_VERTICAL,
  SNAP_VELOCITY_THRESHOLD
} from '$lib/utils/constants';

const DEAD_ZONE = 10;

export const drawer = $state({ dragging: false, progress: 0 });

interface DrawerHandlerOpts {
  sidebarWidth: number;
  isOpen: () => boolean;
  onSnap: (open: boolean) => void;
}

export function createDrawerHandlers(opts: DrawerHandlerOpts) {
  let startX = 0;
  let startY = 0;
  let startProgress = 0;
  let tracking = false;
  let cancelled = false;
  let history: { x: number; t: number }[] = [];

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startProgress = opts.isOpen() ? 1 : 0;
    tracking = true;
    cancelled = false;
    drawer.dragging = false;
    history = [{ x: touch.clientX, t: event.timeStamp }];

    if (!opts.isOpen() && touch.clientX > window.innerWidth * DRAWER_EDGE_ZONE) {
      tracking = false;
      cancelled = true;
    }
  }

  function handleTouchMove(event: TouchEvent) {
    if (!tracking || cancelled) return;

    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = Math.abs(touch.clientY - startY);

    if (!drawer.dragging) {
      if (dy > SWIPE_MAX_VERTICAL) {
        cancelled = true;
        return;
      }
      if (Math.abs(dx) < DEAD_ZONE) return;
      drawer.dragging = true;
    }

    const delta = dx / opts.sidebarWidth;
    drawer.progress = Math.min(1, Math.max(0, startProgress + delta));

    history.push({ x: touch.clientX, t: event.timeStamp });
    if (history.length > 5) history.shift();
  }

  function handleTouchEnd() {
    if (!tracking || cancelled || !drawer.dragging) {
      tracking = false;
      drawer.dragging = false;
      return;
    }

    let velocity = 0;
    if (history.length >= 2) {
      const first = history[0];
      const last = history[history.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) velocity = (last.x - first.x) / dt;
    }

    let snapOpen: boolean;
    if (Math.abs(velocity) > SNAP_VELOCITY_THRESHOLD) {
      snapOpen = velocity > 0;
    } else {
      snapOpen = drawer.progress > 0.5;
    }

    drawer.dragging = false;
    tracking = false;
    opts.onSnap(snapOpen);
  }

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
}
