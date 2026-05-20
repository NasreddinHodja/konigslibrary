<script lang="ts">
  let { class: cls = '', style = '' }: { class?: string; style?: string } = $props();
</script>

<div class="skeleton {cls}" {style}></div>
