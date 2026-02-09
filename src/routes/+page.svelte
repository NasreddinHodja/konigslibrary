<script lang="ts">
  import { manga, setFiles, getChapters, getLastChapter } from '$lib/state.svelte';

  const chapters = $derived(getChapters());

  $effect(() => {
    if (chapters.length > 0 && !manga.selectedChapter) {
      const lastName = getLastChapter();
      const saved = lastName ? chapters.find((c) => c.name === lastName) : null;
      manga.selectedChapter = saved ?? chapters[0];
    }
  });
  import PageScrollViewer from '$lib/PageScrollViewer.svelte';
  import PageTurnViewer from '$lib/PageTurnViewer.svelte';
  import Sidebar from '$lib/Sidebar.svelte';
</script>

{#if chapters.length === 0}
  <div class="flex h-screen items-center justify-center">
    <label class="cursor-pointer border-2 px-6 py-3 hover:bg-white/20">
      Upload manga
      <input
        type="file"
        accept="image/*"
        multiple
        onchange={(e) => {
          const input = e.target as HTMLInputElement;
          if (input.files) setFiles(Array.from(input.files));
        }}
        class="hidden"
        webkitdirectory
      />
    </label>
  </div>
{:else}
  <div class="flex h-screen">
    <Sidebar />

    {#if manga.selectedChapter}
      {#if manga.scrollMode}
        <PageScrollViewer />
      {:else}
        <PageTurnViewer />
      {/if}
    {:else}
      <div class="flex flex-1 items-center justify-center">
        <button
          class="border-2 px-6 py-3 hover:bg-white/20"
          onclick={() => (manga.sidebarOpen = true)}
        >
          Select a chapter
        </button>
      </div>
    {/if}
  </div>
{/if}
