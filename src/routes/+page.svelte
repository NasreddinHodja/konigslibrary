<script lang="ts">
  import { manga, setZip, getChapters, saveProgress } from '$lib/state.svelte';
  import PageScrollViewer from '$lib/PageScrollViewer.svelte';
  import PageTurnViewer from '$lib/PageTurnViewer.svelte';
  import Sidebar from '$lib/Sidebar.svelte';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import LibraryBrowser from '$lib/LibraryBrowser.svelte';
  import NativeLibraryBrowser from '$lib/NativeLibraryBrowser.svelte';
  import OfflineBrowser from '$lib/ui/OfflineBrowser.svelte';
  import SettingsPanel from '$lib/SettingsPanel.svelte';
  import { isNative } from '$lib/platform';
  import { getServerUrl, setServerUrl, isLocalServer } from '$lib/constants';
  import { CircleHelp } from 'lucide-svelte';
  import ToastStack from '$lib/ui/ToastStack.svelte';

  const native = isNative();
  const chapters = $derived(getChapters());
  let serverUrl = $state(getServerUrl());

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
    if (native) return;
    if (isMobile && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  $effect(() => {
    if (native) return;
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

<ToastStack />

{#if chapters.length === 0}
  {#if !native}
    <a
      href="/about"
      class="fixed top-4 right-4 z-10 opacity-40 hover:opacity-80"
      aria-label="How to use"
    >
      <CircleHelp size={24} />
    </a>
  {/if}
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

    {#if native}
      <div class="w-full max-w-2xl space-y-2">
        <h2 class="mb-2 text-lg font-bold opacity-80">Server</h2>
        <div class="flex gap-2">
          <input
            type="text"
            bind:value={serverUrl}
            placeholder="http://192.168.0.100:3000"
            class="flex-1 border-2 bg-black px-3 py-2 text-sm text-white placeholder:opacity-40"
          />
          <Button
            size="md"
            onclick={() => {
              setServerUrl(serverUrl);
              location.reload();
            }}>Connect</Button
          >
        </div>
      </div>
      <OfflineBrowser />
      <LibraryBrowser />
      <NativeLibraryBrowser />
    {:else if isLocalServer}
      <OfflineBrowser />
      <LibraryBrowser />

      <div class="flex flex-col items-center gap-3">
        <a
          href="/download/konigslibrary.apk"
          download
          class="border-2 border-white/20 px-4 py-2 text-sm whitespace-nowrap hover:border-white/60"
        >
          Android APK
        </a>
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
    {:else}
      <OfflineBrowser />
      <div class="flex flex-col items-center gap-3">
        <p class="max-w-sm text-center text-sm opacity-60">
          Run locally to serve manga from your PC to any device on your network
        </p>
        <div class="flex flex-wrap justify-center gap-4">
          <a
            href="/download/konigslibrary.sh"
            download
            class="border-2 border-white/20 px-4 py-2 text-sm whitespace-nowrap hover:border-white/60"
          >
            Linux / Mac
          </a>
          <a
            href="/download/konigslibrary.bat"
            download
            class="border-2 border-white/20 px-4 py-2 text-sm whitespace-nowrap hover:border-white/60"
          >
            Windows
          </a>
          <a
            href="/download/konigslibrary.apk"
            download
            class="border-2 border-white/20 px-4 py-2 text-sm whitespace-nowrap hover:border-white/60"
          >
            Android
          </a>
        </div>
      </div>
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
