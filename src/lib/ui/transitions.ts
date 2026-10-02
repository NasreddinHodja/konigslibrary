import { fade } from 'svelte/transition';
import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';

/// The app's exit fade.
export const fadeOut = (node: Element) =>
  fade(node, { duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN });

/// Fades in once whatever it replaces has faded out, so the two don't overlap.
export const fadeInAfter = (node: Element) =>
  fade(node, { duration: ANIM_DURATION, delay: ANIM_EXIT_DURATION, easing: ANIM_EASE });
