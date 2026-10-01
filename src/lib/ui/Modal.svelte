<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import Backdrop from './Backdrop.svelte';
  import { focusTrap } from './focus-trap';

  // A centered dialog over a backdrop. Closes on a backdrop click or Escape.
  let {
    label,
    onclose,
    class: panelClass = '',
    children
  }: {
    label: string;
    onclose: () => void;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<Backdrop onclick={onclose} />
<div
  class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
  role="dialog"
  aria-modal="true"
  aria-label={label}
  {@attach focusTrap}
>
  <div
    class="pointer-events-auto w-full border-2 {panelClass}"
    in:fly={{ y: 10, duration: ANIM_DURATION, easing: ANIM_EASE }}
    out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
  >
    {@render children()}
  </div>
</div>
