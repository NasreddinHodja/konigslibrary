<script lang="ts">
  let { onclick, opacity = 0.5 }: { onclick: () => void; opacity?: number } = $props();
</script>

<button
  class="duration-anim fixed inset-0 z-40 bg-black transition-opacity ease-anim"
  style="opacity: {opacity}"
  aria-label="Close"
  {onclick}
></button>
