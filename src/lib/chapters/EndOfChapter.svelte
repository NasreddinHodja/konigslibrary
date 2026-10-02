<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';
  import { chapterLabel } from '$lib/utils/chapters';
  import Button from '$lib/ui/Button.svelte';

  // Fills a page-turn panel by default; the scroll viewer gives it a fixed box.
  let { class: className = 'min-h-full py-24' }: { class?: string } = $props();

  const reader = getReaderContext();
  const { state: manga } = reader;

  let nextChapter: string | null = $derived(reader.getNextChapter());
</script>

<div class="flex w-full flex-col items-center justify-center gap-6 {className}">
  <p class="text-lg text-dim">End of {chapterLabel(manga.selectedChapter ?? '')}</p>
  <div class="flex flex-col items-center gap-3">
    {#if nextChapter}
      <Button size="lg" variant="primary" onclick={() => reader.goToNextChapter()}>
        {chapterLabel(nextChapter)}
        <ChevronRight size={16} />
      </Button>
    {:else}
      <span class="px-6 py-3 text-sm text-dim">No next chapter</span>
    {/if}
  </div>
</div>
