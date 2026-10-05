import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import { clearMocks } from '@tauri-apps/api/mocks';
import { FakeIntersectionObserver } from './intersection';

// What jsdom leaves out that the app calls.

// No image decoding: resolve at once, as for an image already in cache.
HTMLImageElement.prototype.decode = () => Promise.resolve();

// No layout, so nothing ever resizes; Svelte's bind:clientWidth needs one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Object URLs: vitest's jsdom has its own, which fails on a Blob from fetch.
// Here each blob gets a URL of its own, and revoking does nothing; tests spy on
// both to see what a module creates and lets go of.
let objectUrls = 0;
URL.createObjectURL = () => `blob:test/${++objectUrls}`;
URL.revokeObjectURL = () => {};

// No scrolling either; tests spy on this to see where a component scrolls to.
Element.prototype.scrollTo ??= () => {};

globalThis.IntersectionObserver ??= FakeIntersectionObserver;

// No `inert`: without it Svelte's `inert={…}` sets a plain property and leaves
// no trace in the DOM. Reflected to the attribute, as the spec has it. Testing
// Library still doesn't treat inert content as hidden, so tests scope to it.
if (!('inert' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'inert', {
    get(this: HTMLElement) {
      return this.hasAttribute('inert');
    },
    set(this: HTMLElement, value: boolean) {
      this.toggleAttribute('inert', !!value);
    }
  });
}

// No media either: no query matches, so no reduced motion and no breakpoints.
window.matchMedia ??= (media: string) =>
  ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false
  }) as MediaQueryList;

// No Web Animations, which Svelte runs transitions on: each one finishes at
// once, so an outro's element is gone after the next microtask.
Element.prototype.animate ??= function () {
  const animation = {
    onfinish: null as (() => void) | null,
    playState: 'finished',
    currentTime: 0,
    effect: null,
    cancel() {}
  };
  queueMicrotask(() => animation.onfinish?.());
  return animation as unknown as Animation;
};

// No network: a request no test answered fails, rather than leaving the
// machine. Tests answer with fakeServer, which replaces this.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`unanswered fetch: ${String(input)}`);
    })
  );
});

// State that would otherwise leak from one test into the next.
afterEach(async () => {
  // Unmounted first: components let go of Tauri listeners as they go, some
  // only once a command still in flight has answered.
  cleanup();
  await new Promise((r) => setTimeout(r));
  localStorage.clear();
  clearMocks();
  // clearMocks leaves the object, which is how the app tells it runs in Tauri.
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});
