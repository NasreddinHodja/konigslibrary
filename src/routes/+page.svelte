<script lang="ts">
  import { manga, setZip, getChapters, saveProgress } from '$lib/state.svelte';
  import PageScrollViewer from '$lib/PageScrollViewer.svelte';
  import PageTurnViewer from '$lib/PageTurnViewer.svelte';
  import Sidebar from '$lib/Sidebar.svelte';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import LibraryBrowser from '$lib/LibraryBrowser.svelte';
  import SettingsPanel from '$lib/SettingsPanel.svelte';

  const chapters = $derived(getChapters());

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!manga.selectedChapter) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProgress, 300);
    return () => clearTimeout(saveTimer);
  });

  const handleDrop = async (e: DragEvent) => {
    const file = e.dataTransfer?.files[0];
    if (file && /\.(zip|cbz)$/i.test(file.name)) await setZip(file);
  };

  let showSettings = $state(false);

  let isMobile = $derived(typeof window !== 'undefined' && 'ontouchstart' in window);

  function enterFullscreen() {
    if (isMobile && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  $effect(() => {
    if (!manga.selectedChapter && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  });
</script>

<svelte:document
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => {
    e.preventDefault();
    handleDrop(e);
  }}
/>

{#if chapters.length === 0}
  <div class="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
    <label class="cursor-pointer">
      <Button size="lg" as="span">Upload manga</Button>
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

    <LibraryBrowser />

    <div class="flex flex-col items-center gap-3">
      <p class="max-w-sm text-center text-sm opacity-60">
        Run locally to serve manga from your PC to any device on your network
      </p>
      <div class="flex gap-4">
        <a
          href="/download/konigslibrary.sh"
          download
          class="border-2 border-white/20 px-4 py-2 text-sm hover:border-white/60"
        >
          Linux / Mac
        </a>
        <a
          href="/download/konigslibrary.bat"
          download
          class="border-2 border-white/20 px-4 py-2 text-sm hover:border-white/60"
        >
          Windows
        </a>
      </div>
    </div>

    <button
      class="mt-4 text-sm opacity-40 hover:opacity-80"
      onclick={() => (showSettings = !showSettings)}
    >
      {showSettings ? 'Hide settings' : 'Settings'}
    </button>

    {#if showSettings}
      <SettingsPanel />
    {/if}
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div
    class="flex h-screen select-none md:pl-(--sidebar-peek)"
    onclick={enterFullscreen}
    role="presentation"
  >
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
