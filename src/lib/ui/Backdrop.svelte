<script lang="ts">
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';

  let { onclick, opacity = 0.5 }: { onclick: () => void; opacity?: number } = $props();
</script>

<button
  class="fixed inset-0 z-40 bg-bg"
  style="opacity: {opacity}"
  aria-label="Close"
  {onclick}
  in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
  out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
></button>
