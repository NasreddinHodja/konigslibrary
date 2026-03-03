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
  <div class="w-full min-w-0 space-y-1">
    <h2 class="mb-3 text-sm font-bold tracking-widest opacity-60">DOWNLOADED</h2>
    {#each entries as entry (entry.slug)}
      <div class="flex w-full items-center gap-2 border-2 px-3 py-2">
        <button
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm hover:opacity-80"
          onclick={() => setSource(new OfflineDbProvider(entry.slug, entry.name))}
        >
          <BookOpen size={16} class="shrink-0 opacity-40" />
          <span class="truncate">{entry.name}</span>
        </button>
        <button
          class="shrink-0 p-1 opacity-30 hover:opacity-100"
          onclick={() => remove(entry.slug)}
          aria-label="Delete {entry.name}"
        >
          <Trash2 size={14} />
        </button>
      </div>
    {/each}
  </div>
{/if}
