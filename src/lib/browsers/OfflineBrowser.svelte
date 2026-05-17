<script lang="ts">
  import { listOfflineManga, deleteOfflineManga } from '$lib/sources/offline-db';
  import { getReaderContext } from '$lib/context';
  import { OfflineDbProvider } from '$lib/sources';
  import { Trash2 } from 'lucide-svelte';

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
  <div class="w-full min-w-0">
    <p class="mb-2 text-xs font-bold tracking-widest opacity-30">DOWNLOADED</p>
    <div class="border-2">
      {#each entries as entry (entry.slug)}
        <div class="flex items-center border-b border-white/10 last:border-b-0">
          <button
            class="flex min-w-0 flex-1 cursor-pointer px-4 py-3 text-left text-sm hover:bg-white/10"
            onclick={() => setSource(new OfflineDbProvider(entry.slug, entry.name))}
          >
            <span class="truncate">{entry.name}</span>
          </button>
          <button
            class="shrink-0 cursor-pointer px-3 py-3 opacity-20 hover:opacity-80"
            onclick={() => remove(entry.slug)}
            aria-label="Delete {entry.name}"
          >
            <Trash2 size={14} />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}
