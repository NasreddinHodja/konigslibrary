<script lang="ts">
  let { onclick }: { onclick: () => void } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="duration-anim fixed inset-0 z-40 bg-black/50 transition-opacity ease-anim"
  {onclick}
></div>
