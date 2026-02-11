<script lang="ts">
  import { manga, setZip, getChapters, saveProgress } from '$lib/state.svelte';

  const chapters = $derived(getChapters());

  $effect(() => {
    if (manga.selectedChapter) saveProgress();
  });
  import PageScrollViewer from '$lib/PageScrollViewer.svelte';
  import PageTurnViewer from '$lib/PageTurnViewer.svelte';
  import Sidebar from '$lib/Sidebar.svelte';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';

  const handleDrop = async (e: DragEvent) => {
    const file = e.dataTransfer?.files[0];
    if (file && /\.(zip|cbz)$/i.test(file.name)) await setZip(file);
  };
</script>

<svelte:document
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => {
    e.preventDefault();
    handleDrop(e);
  }}
/>

{#if chapters.length === 0}
  <div class="flex h-screen items-center justify-center">
    <label class="cursor-pointer">
      <Button size="lg">Upload manga</Button>
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
      <EmptyState>
        <Button size="lg" onclick={() => (manga.sidebarOpen = true)}>Select a chapter</Button>
      </EmptyState>
    {/if}
  </div>
{/if}
