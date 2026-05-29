<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getReaderContext } from '$lib/context';
  import { OfflineFsProvider } from '$lib/sources';
  import { addToast, updateToast } from '$lib/ui/toast.svelte';
  import { Trash2 } from 'lucide-svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';

  const { setSource, events } = getReaderContext();

  let entries: { slug: string; name: string }[] = $state([]);
  let pendingDelete: { slug: string; name: string } | null = $state(null);

  function refreshEntries() {
    invoke<{ slug: string; name: string }[]>('list_offline_manga').then((list) => {
      entries = list;
    });
  }

  $effect(() => {
    refreshEntries();
    const unsub = events.on('download:complete', () => refreshEntries());
    return unsub;
  });

  async function confirmRemove() {
    if (!pendingDelete) return;
    const { slug, name } = pendingDelete;
    pendingDelete = null;

    const id = `del-${Date.now()}`;
    addToast({ id, label: name, current: 0, total: 0, phase: 'deleting' });

    await invoke('delete_offline_manga', { slug });

    entries = entries.filter((e) => e.slug !== slug);
    events.emit('download:deleted', { slug });
    updateToast(id, { phase: 'done' });
  }
</script>

{#if pendingDelete}
  <ConfirmDialog
    message={`Delete "${pendingDelete.name}"? This will remove all downloaded pages.`}
    confirmLabel="Delete"
    onconfirm={confirmRemove}
    oncancel={() => (pendingDelete = null)}
  />
{/if}

{#if entries.length > 0}
  <div class="w-full min-w-0">
    <p class="mb-2 text-xs font-bold tracking-widest opacity-30">DOWNLOADED</p>
    <div class="border-2">
      {#each entries as entry (entry.slug)}
        <div class="flex items-center border-b border-white/10 last:border-b-0">
          <button
            class="flex min-w-0 flex-1 cursor-pointer px-4 py-3 text-left text-sm hover:bg-white/10"
            onclick={() => setSource(new OfflineFsProvider(entry.slug, entry.name))}
          >
            <span class="truncate">{entry.name}</span>
          </button>
          <button
            class="shrink-0 cursor-pointer px-3 py-3 opacity-20 hover:opacity-80"
            onclick={() => (pendingDelete = entry)}
            aria-label="Delete {entry.name}"
          >
            <Trash2 size={14} />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}
