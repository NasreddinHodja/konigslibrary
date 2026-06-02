import type { MangaState } from '$lib/context';

export const PRELOAD_AHEAD = 5;
export const PRELOAD_BEHIND = 2;

export function usePreloader(
  state: MangaState,
  getPageUrls: () => string[],
  getLoading: () => boolean,
  initialDecoded: () => Map<number, HTMLImageElement>,
  ensurePageUrl?: (index: number) => void
) {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const cache = new Map<number, HTMLImageElement>();

  $effect(() => {
    const decoded = initialDecoded();
    for (const [idx, img] of decoded) {
      cache.set(idx, img);
    }
  });

  $effect(() => {
    const urls = getPageUrls();
    if (getLoading() || urls.length === 0) return;
    const current = state.currentPage;
    const start = Math.max(0, current - PRELOAD_BEHIND);
    const end = Math.min(urls.length - 1, current + PRELOAD_AHEAD);

    for (let i = start; i <= end; i++) {
      if (!cache.has(i)) {
        if (urls[i]) {
          const img = new Image();
          img.src = urls[i];
          img.decode().catch(() => {});
          cache.set(i, img);
        } else {
          ensurePageUrl?.(i);
        }
      }
    }

    for (const [idx] of cache) {
      if (idx < start || idx > end) {
        cache.delete(idx);
      }
    }
  });

  return cache;
}
