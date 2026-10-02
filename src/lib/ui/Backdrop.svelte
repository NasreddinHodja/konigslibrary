<script lang="ts">
  import { fadeOut } from '$lib/ui/transitions';

  let { onclick }: { onclick: () => void } = $props();
</script>

<button
  class="fixed inset-0 z-40 bg-bg opacity-50 backdrop-blur-sm"
  aria-label="Close"
  {onclick}
  out:fadeOut
></button>
