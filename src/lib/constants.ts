export const ANIM_DURATION = 300;

// quartic ease-out — matches CSS cubic-bezier(0.25, 1, 0.5, 1) in layout.css
export const ANIM_EASE = (t: number) => 1 - Math.pow(1 - t, 4);

export const LS_SCROLL_MODE = 'kl:scrollMode';
export const LS_RTL = 'kl:rtl';
export const LS_DOUBLE_PAGE = 'kl:doublePage';
export const LS_PROGRESS_PREFIX = 'kl:';

export const INTERSECT_THRESHOLD = 0.5;

export const SWIPE_MIN_HORIZONTAL = 30;
export const SWIPE_MAX_VERTICAL = 50;

export const PAGE_TURN_ZOOM = 2;
