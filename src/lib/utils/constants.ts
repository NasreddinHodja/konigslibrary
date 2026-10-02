export const reducedMotion =
  typeof globalThis.matchMedia === 'function' &&
  globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ANIM_DURATION = reducedMotion ? 0 : 120;
export const ANIM_EXIT_DURATION = reducedMotion ? 0 : 90;

export const ANIM_EASE = (t: number) => 1 - Math.pow(1 - t, 3);
export const ANIM_EASE_IN = (t: number) => t * t * t;

export const LS_SCROLL_MODE = 'kl:scrollMode';
export const LS_RTL = 'kl:rtl';
export const LS_PROGRESS_PREFIX = 'kl:progress:';

/// Chapter archives, by file name.
export const ZIP_EXT = /\.(zip|cbz)$/i;

/// A manga folder's cover, by file name.
export const COVER = /^cover\.(jpe?g|png|webp|gif|avif|bmp)$/i;

/// The most chapter archives a manga may hold: klparse's `MAX_CHAPTERS`,
/// checked here before any archive is read.
export const MAX_CHAPTERS = 5000;

/// An error for a manga of `count` chapter archives, past `MAX_CHAPTERS`.
export function checkChapterCount(count: number) {
  if (count > MAX_CHAPTERS)
    throw new Error(`${count} chapter archives; a manga can have at most ${MAX_CHAPTERS}`);
}

export const DEFAULT_PAGE_RATIO = 1.5; // height / width, typical manga page

export const PAGE_TURN_ZOOM = 2;

const LS_SERVER_URL = 'kl:serverUrl';

const browser = typeof localStorage !== 'undefined';

export function getServerUrl(): string {
  if (!browser) return '';
  return localStorage.getItem(LS_SERVER_URL) || '';
}

export function setServerUrl(url: string) {
  if (browser) localStorage.setItem(LS_SERVER_URL, url);
}

export function apiUrl(path: string): string {
  const base = getServerUrl().replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

declare const __LOCAL_BUILD__: boolean;
export const isLocalServer = __LOCAL_BUILD__;
