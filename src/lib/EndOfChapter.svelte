<script lang="ts">
  import { ArrowLeft, ChevronRight } from 'lucide-svelte';
  import { getReaderContext } from '$lib/context';

  let { onback }: { onback?: () => void } = $props();

  const svc = getReaderContext();
  const { state: manga } = svc;

  let nextChapter: string | null = $derived(svc.getNextChapter());
</script>

<div class="flex min-h-full w-full flex-col items-center justify-center gap-6 py-24">
  <p class="text-lg opacity-50">End of {manga.selectedChapter}</p>
  <div class="flex items-center gap-4">
    {#if onback}
      <button
        class="flex items-center gap-2 border-2 border-white px-6 py-3 text-sm font-bold transition-opacity hover:opacity-80"
        onclick={onback}
      >
        <ArrowLeft size={16} />
        Back
      </button>
    {/if}
    <button
      class="flex items-center gap-2 border-2 border-white px-6 py-3 text-sm font-bold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
      disabled={!nextChapter}
      onclick={() => svc.goToNextChapter()}
    >
      {#if nextChapter}
        Next: {nextChapter}
      {:else}
        No next chapter
      {/if}
      <ChevronRight size={16} />
    </button>
  </div>
</div>
