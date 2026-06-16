<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getReaderContext } from '$lib/context';
  import { OfflineFsProvider } from '$lib/sources';
  import { addToast, updateToast } from '$lib/ui/toast.svelte';
  import { isNative } from '$lib/utils/platform';
  import { Trash2 } from 'lucide-svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import MangaList from './MangaList.svelte';

  const { setSource, events } = getReaderContext();

  let entries: { slug: string; name: string }[] = $state([]);
  let pendingDelete: { slug: string; name: string } | null = $state(null);

  const listEntries = $derived(entries.map((e) => ({ id: e.slug, name: e.name })));

  function refreshEntries() {
    if (!isNative()) return;
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
    if (!pendingDelete || !isNative()) return;
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

<MangaList
  title="DOWNLOADED"
  entries={listEntries}
  loading={false}
  onopen={(id) => {
    const entry = entries.find((e) => e.slug === id)!;
    setSource(new OfflineFsProvider(entry.slug, entry.name));
  }}
  action={{
    icon: Trash2,
    onclick: (id) => (pendingDelete = entries.find((e) => e.slug === id) ?? null)
  }}
/>
