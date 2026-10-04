import { flushSync } from 'svelte';

type Point = { x: number; y: number };

/// Dispatches a touch event with plain points: jsdom's TouchEvent only takes
/// real Touch objects, which it can't construct.
export function touch(
  el: Element,
  type: 'touchstart' | 'touchmove' | 'touchend',
  points: Point[],
  timeStamp: number
) {
  const list = points.map((p) => ({ clientX: p.x, clientY: p.y }));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : list },
    changedTouches: { value: list },
    timeStamp: { value: timeStamp }
  });
  el.dispatchEvent(event);
  flushSync();
}

/// A one-finger swipe from `from` to `to` over `ms` milliseconds.
export function swipe(el: Element, from: Point, to: Point, ms = 50) {
  touch(el, 'touchstart', [from], 0);
  touch(el, 'touchmove', [to], ms);
  touch(el, 'touchend', [to], ms + 10);
}

export function tap(el: Element, at: Point) {
  touch(el, 'touchstart', [at], 0);
  touch(el, 'touchend', [at], 50);
}
