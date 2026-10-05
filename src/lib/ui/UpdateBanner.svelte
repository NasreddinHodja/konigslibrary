<script lang="ts">
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  import { onMount } from 'svelte';
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
    class="fixed top-0 right-0 left-0 z-50 flex items-center gap-3 border-b border-ink bg-bg px-3 py-2"
    style="padding-top: calc(0.5rem + var(--safe-top))"
  >
    <span>update available: v{update.version}</span>
    <span class="ml-auto"
      ><Button onclick={download}><Icon name="download" /> download</Button></span
    >
    <button
      class="hit relative flex cursor-pointer items-center justify-center text-ink hover:text-hi"
      onclick={dismiss}
      aria-label="Dismiss"
    >
      <Icon name="close" />
    </button>
  </div>
{/if}
