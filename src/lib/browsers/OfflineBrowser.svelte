<script lang="ts">
  import { listOfflineManga, deleteOfflineManga } from '$lib/sources/offline-db';
  import { getReaderContext } from '$lib/context';
  import { OfflineDbProvider } from '$lib/sources';
  import { BookOpen, Trash2 } from 'lucide-svelte';

  const { setSource, events } = getReaderContext();

  let entries: { slug: string; name: string }[] = $state([]);

  function refreshEntries() {
    listOfflineManga().then((list) => {
      entries = list;
    });
  }

  $effect(() => {
    refreshEntries();
    const unsub = events.on('download:complete', () => refreshEntries());
    return unsub;
  });

  async function remove(slug: string) {
    await deleteOfflineManga(slug);
    entries = entries.filter((e) => e.slug !== slug);
  }
</script>

{#if entries.length > 0}
  <div class="w-full max-w-2xl space-y-2">
    <h2 class="mb-4 text-lg font-bold opacity-80">Downloaded</h2>
    {#each entries as entry (entry.slug)}
      <div class="flex w-full items-center gap-3 border-2 px-4 py-3">
        <button
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left hover:opacity-80"
          onclick={() => setSource(new OfflineDbProvider(entry.slug, entry.name))}
        >
          <BookOpen size={20} class="shrink-0 opacity-60" />
          <span class="truncate">{entry.name}</span>
        </button>
        <button
          class="shrink-0 p-1 opacity-40 hover:opacity-100"
          onclick={() => remove(entry.slug)}
          aria-label="Delete {entry.name}"
        >
          <Trash2 size={16} />
        </button>
      </div>
    {/each}
  </div>
{/if}
