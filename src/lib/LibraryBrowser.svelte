<script lang="ts">
  import type { LibraryEntry } from '$lib/types';
  import { setLibraryManga } from '$lib/state.svelte';
  import { BookOpen, FileArchive } from 'lucide-svelte';
  import Loader from '$lib/ui/Loader.svelte';

  let entries: LibraryEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  $effect(() => {
    fetch('/api/library')
      .then((r) => r.json())
      .then((data: LibraryEntry[]) => {
        entries = data;
        loading = false;
      })
      .catch(() => {
        error = 'Could not connect to library';
        loading = false;
      });
  });

  const open = (entry: LibraryEntry) => {
    setLibraryManga(entry.slug, entry.name);
  };
</script>

{#if loading}
  <Loader />
{:else if error}
  <p class="text-sm opacity-60">{error}</p>
{:else if entries.length > 0}
  <div class="w-full max-w-2xl space-y-2">
    <h2 class="mb-4 text-lg font-bold opacity-80">Library</h2>
    {#each entries as entry (entry.slug)}
      <button
        class="flex w-full cursor-pointer items-center gap-3 border-2 px-4 py-3 text-left hover:bg-white/10"
        onclick={() => open(entry)}
      >
        {#if entry.type === 'zip'}
          <FileArchive size={20} class="shrink-0 opacity-60" />
        {:else}
          <BookOpen size={20} class="shrink-0 opacity-60" />
        {/if}
        <span class="truncate">{entry.name}</span>
      </button>
    {/each}
  </div>
{/if}
