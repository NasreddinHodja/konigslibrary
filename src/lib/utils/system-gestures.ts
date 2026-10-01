// Where the system's back gesture lives, so a swipe starting there is left to
// it. Android only lets the gesture win after the first moves have reached the
// page, then cancels the touch; anything dragging on those moves would twitch.

type Bridge = { systemGestureInsets?: () => string };

let cached: { left: number; right: number } | null = null;

/// Widths of the left and right gesture zones in CSS px, from the Android
/// bridge; zero where there is none (desktop, the browser).
function zones(): { left: number; right: number } {
  if (cached) return cached;
  const raw = (window as unknown as { __kl?: Bridge }).__kl?.systemGestureInsets?.() ?? '0,0';
  const [left, right] = raw.split(',').map(Number);
  cached = { left: left || 0, right: right || 0 };
  return cached;
}

if (typeof window !== 'undefined') {
  // Rotation and window changes move the zones; read them again next time.
  window.addEventListener('resize', () => (cached = null));
  document.addEventListener('visibilitychange', () => (cached = null));
}

/// Whether a touch starting at `x` (CSS px from the left) is in a system
/// gesture zone.
export function inSystemGesture(x: number): boolean {
  const { left, right } = zones();
  return x < left || x > window.innerWidth - right;
}
