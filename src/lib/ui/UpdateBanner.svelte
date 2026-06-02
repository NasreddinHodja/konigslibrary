<script lang="ts">
  import { onMount } from 'svelte';
  import { X, Download } from 'lucide-svelte';
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
    if (update) window.open(update.downloadUrl, '_blank');
  }
</script>

{#if update}
  <div
    class="fixed top-0 right-0 left-0 z-50 flex items-center gap-3 border-b-2 border-white bg-black px-4 py-2"
    style="padding-top: calc(0.5rem + var(--safe-top))"
  >
    <span class="font-mono text-sm text-white">update available: v{update.version}</span>
    <button
      class="ml-auto flex items-center gap-1 border-2 border-white px-2 py-1 font-mono text-xs text-white hover:bg-white hover:text-black"
      onclick={download}
    >
      <Download size={12} />
      download
    </button>
    <button class="text-white hover:text-gray-400" onclick={dismiss} aria-label="Dismiss">
      <X size={16} />
    </button>
  </div>
{/if}
