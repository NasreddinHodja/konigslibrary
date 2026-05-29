<script lang="ts">
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';

  let { onclick, opacity = 0.5 }: { onclick: () => void; opacity?: number } = $props();
</script>

<button
  class="fixed inset-0 z-40 bg-bg"
  style="opacity: {opacity}"
  aria-label="Close"
  {onclick}
  transition:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
></button>
