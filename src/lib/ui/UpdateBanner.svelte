<script lang="ts">
  import { onMount } from 'svelte';
  import { X, Download } from 'lucide-svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { checkForUpdate, dismissUpdate, type UpdateInfo } from '$lib/utils/update';

  let update = $state<UpdateInfo | null>(null);

  onMount(async () => {
    update = await checkForUpdate();
  });

  function dismiss() {
    if (update) dismissUpdate(update.version);
    update = null;
  }

  function download() {
    if (!update) return;
    openUrl(update.downloadUrl);
  }
</script>

{#if update}
  <div
    class="fixed top-0 right-0 left-0 z-50 flex items-center gap-3 border-b-2 border-border bg-bg px-4 py-2"
    style="padding-top: calc(0.5rem + var(--safe-top))"
  >
    <span class="font-mono text-sm text-fg">Update available: v{update.version}</span>
    <button
      class="hit relative ml-auto flex items-center gap-1 border-2 border-border px-2 py-1 font-mono text-xs font-bold tracking-widest text-fg hover:bg-fg hover:text-bg"
      onclick={download}
    >
      <Download size={12} />
      DOWNLOAD
    </button>
    <button class="hit relative text-fg hover:text-muted" onclick={dismiss} aria-label="Dismiss">
      <X size={16} />
    </button>
  </div>
{/if}
