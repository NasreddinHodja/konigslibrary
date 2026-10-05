<script lang="ts">
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
  <p class="text-dim">End of {chapterLabel(manga.selectedChapter ?? '')}</p>
  {#if nextChapter}
    <Button variant="primary" onclick={() => reader.goToNextChapter()}>
      next: {chapterLabel(nextChapter).toLowerCase()}
    </Button>
  {:else}
    <span class="text-dim">No next chapter</span>
  {/if}
</div>
