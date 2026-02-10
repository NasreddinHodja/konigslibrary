<script lang="ts">
  import { manga, setZip, getChapters, getProgress, saveProgress } from '$lib/state.svelte';

  const chapters = $derived(getChapters());

  let initialized = false;
  $effect(() => {
    if (chapters.length > 0 && !initialized) {
      initialized = true;
      const saved = getProgress();
      if (saved && chapters.find((c) => c.name === saved.chapter)) {
        manga.selectedChapter = saved.chapter;
        manga.currentPage = saved.page;
        manga.shouldScroll = true;
      } else {
        manga.selectedChapter = chapters[0].name;
      }
    }
  });

  $effect(() => {
    if (manga.selectedChapter) saveProgress();
  });
  import PageScrollViewer from '$lib/PageScrollViewer.svelte';
  import PageTurnViewer from '$lib/PageTurnViewer.svelte';
  import Sidebar from '$lib/Sidebar.svelte';

  const handleDrop = async (e: DragEvent) => {
    const file = e.dataTransfer?.files[0];
    if (file && /\.(zip|cbz)$/i.test(file.name)) await setZip(file);
  };
</script>

<svelte:document ondragover|preventDefault={() => {}} ondrop|preventDefault={handleDrop} />

{#if chapters.length === 0}
  <div class="flex h-screen items-center justify-center">
    <label class="cursor-pointer border-2 px-6 py-3 hover:bg-white/20">
      Upload manga
      <input
        type="file"
        accept=".zip,.cbz"
        onchange={async (e) => {
          const input = e.target as HTMLInputElement;
          if (input.files?.[0]) await setZip(input.files[0]);
        }}
        class="hidden"
      />
    </label>
  </div>
{:else}
  <div class="flex h-screen select-none">
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
