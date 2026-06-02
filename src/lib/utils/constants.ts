const reducedMotion =
  typeof globalThis.matchMedia === 'function' &&
  globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ANIM_DURATION = reducedMotion ? 0 : 200;
export const ANIM_EXIT_DURATION = reducedMotion ? 0 : 150;

export const ANIM_EASE = (t: number) => 1 - Math.pow(1 - t, 3);
export const ANIM_EASE_IN = (t: number) => t * t * t;

export const LS_SCROLL_MODE = 'kl:scrollMode';
export const LS_RTL = 'kl:rtl';
export const LS_PROGRESS_PREFIX = 'kl:progress:';

export const INTERSECT_THRESHOLD = 0.5;

export const VIRTUAL_BUFFER = 5;
export const DEFAULT_PAGE_RATIO = 1.5; // height / width, typical manga page

export const PAGE_TURN_ZOOM = 2;

export const LS_SERVER_URL = 'kl:serverUrl';

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
