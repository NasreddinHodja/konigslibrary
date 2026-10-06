<script lang="ts">
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import { onMount } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { checkForUpdate, dismissUpdate, type UpdateInfo } from '$lib/utils/update';

  // Offers a newer release, once per launch until it's installed. Later stops
  // asking for that version.
  let update = $state<UpdateInfo | null>(null);

  onMount(async () => {
    update = await checkForUpdate();
  });

  function later() {
    if (update) dismissUpdate(update.version);
    update = null;
  }

  function open(url: string) {
    update = null;
    openUrl(url);
  }
</script>

{#if update}
  {@const { version, current, downloadUrl, notesUrl } = update}
  <Modal label="Update available" onclose={later} class="max-w-sm p-4">
    <p class="mb-2 text-ink">update available</p>
    <p class="mb-4">
      konigslibrary v{version} is out. You have v{current}. The download is an APK from GitHub.
    </p>
    <div class="flex flex-wrap justify-end gap-3">
      <Button variant="text" onclick={later}>later</Button>
      <Button onclick={() => open(notesUrl)}>what's new</Button>
      <Button variant="primary" onclick={() => open(downloadUrl)}>download</Button>
    </div>
  </Modal>
{/if}
