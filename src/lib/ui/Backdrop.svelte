<script lang="ts">
  import { fade } from 'svelte/transition';
  import { ANIM_EXIT_DURATION, ANIM_EASE_IN } from '$lib/utils/constants';

  let { onclick }: { onclick: () => void } = $props();
</script>

<button
  class="fixed inset-0 z-40 bg-bg opacity-50 backdrop-blur-sm"
  aria-label="Close"
  {onclick}
  out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
></button>
