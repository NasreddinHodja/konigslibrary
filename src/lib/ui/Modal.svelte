<script lang="ts">
  import { fadeOut } from '$lib/ui/transitions';
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
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
    class="pointer-events-auto w-full panel {panelClass}"
    in:fly={{ y: 10, duration: ANIM_DURATION, easing: ANIM_EASE }}
    out:fadeOut
  >
    {@render children()}
  </div>
</div>
