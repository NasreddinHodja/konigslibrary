<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import Button from '$lib/ui/Button.svelte';

  const reader = getReaderContext();
  const { state: manga } = reader;

  let nextChapter: string | null = $derived(reader.getNextChapter());
</script>

<div class="flex min-h-full w-full flex-col items-center justify-center gap-6 py-24">
  <p class="text-lg opacity-50">End of {manga.selectedChapter}</p>
  <div class="flex flex-col items-center gap-3">
    {#if nextChapter}
      <Button size="lg" variant="primary" onclick={() => reader.goToNextChapter()}>
        {nextChapter}
        <ChevronRight size={16} />
      </Button>
    {:else}
      <span class="px-6 py-3 text-sm opacity-50">No next chapter</span>
    {/if}
  </div>
</div>
