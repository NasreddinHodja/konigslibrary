<script lang="ts">
  import Spinner from './Spinner.svelte';

  let { label = 'Loading' }: { label?: string } = $props();
</script>

<div class="flex h-full flex-1 items-center justify-center" role="status" aria-label={label}>
  <Spinner />
</div>
