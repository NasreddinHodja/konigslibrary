<script lang="ts">
  import type { LibraryEntry, ServerChapter } from '$lib/types';
  import { setLibraryManga } from '$lib/state.svelte';
  import { apiUrl, getServerUrl } from '$lib/constants';
  import { saveManga } from '$lib/download';
  import { isNative } from '$lib/platform';
  import { BookOpen, FileArchive, Download } from 'lucide-svelte';
  import Loader from '$lib/ui/Loader.svelte';

  let entries: LibraryEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  $effect(() => {
    if (isNative() && !getServerUrl()) {
      loading = false;
      return;
    }
    const url = apiUrl('/api/library');
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: LibraryEntry[]) => {
        entries = data;
        loading = false;
      })
      .catch((e) => {
        error = `Could not connect to library (${url}: ${e.message})`;
        loading = false;
      });
  });

  const open = (entry: LibraryEntry) => {
    setLibraryManga(entry.slug, entry.name);
  };

  async function startDownload(e: MouseEvent, entry: LibraryEntry) {
    e.stopPropagation();
    const res = await fetch(apiUrl(`/api/library/${entry.slug}/chapters`));
    if (!res.ok) return;
    const chapters: ServerChapter[] = await res.json();
    saveManga(entry.slug, entry.name, chapters);
  }
</script>

{#if loading}
  <Loader />
{:else if error}
  <p class="text-sm opacity-60">{error}</p>
{:else if entries.length > 0}
  <div class="w-full max-w-2xl space-y-2">
    <h2 class="mb-4 text-lg font-bold opacity-80">Library</h2>
    {#each entries as entry (entry.slug)}
      <div class="flex w-full items-center gap-3 border-2 px-4 py-3">
        <button
          class="flex flex-1 cursor-pointer items-center gap-3 text-left hover:opacity-80"
          onclick={() => open(entry)}
        >
          {#if entry.type === 'zip'}
            <FileArchive size={20} class="shrink-0 opacity-60" />
          {:else}
            <BookOpen size={20} class="shrink-0 opacity-60" />
          {/if}
          <span class="truncate">{entry.name}</span>
        </button>
        <button
          class="shrink-0 p-1 opacity-40 hover:opacity-100"
          onclick={(e) => startDownload(e, entry)}
          aria-label="Download {entry.name}"
        >
          <Download size={16} />
        </button>
      </div>
    {/each}
  </div>
{/if}
