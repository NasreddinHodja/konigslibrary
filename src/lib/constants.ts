/** Default animation/transition duration in ms */
export const ANIM_DURATION = 300;

/** Standard easing — cubic-bezier(0.16, 1, 0.3, 1) (expo-out) for Svelte transitions */
export const ANIM_EASE = (t: number) => 1 - Math.pow(1 - t, 4);
