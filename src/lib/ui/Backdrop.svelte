<script lang="ts">
  let { onclick }: { onclick: () => void } = $props();
</script>

<button
  class="duration-anim fixed inset-0 z-40 bg-black/50 transition-opacity ease-anim"
  aria-label="Close"
  {onclick}
></button>
