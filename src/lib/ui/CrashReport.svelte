<script lang="ts">
  import { onMount } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import Modal from './Modal.svelte';
  import { showError, showSuccess } from './toast.svelte';
  import { isNative } from '$lib/utils/platform';
  import { copyText } from '$lib/utils/bridge';
  import { crashIssueUrl, readLogs, takeCrashReport } from '$lib/utils/diagnostics';

  // Offers to report the last session's crash, once. Nothing leaves the
  // device unless the reporter submits the GitHub issue it opens.
  let crash = $state<string | null>(null);

  onMount(async () => {
    if (!isNative()) return;
    crash = await takeCrashReport().catch(() => null);
  });

  // The logs too: they show what led up to it. A read that fails, or never
  // answers (the command panicked too), leaves just the crash.
  const LOGS_TIMEOUT = 1000;
  const logs = () =>
    Promise.race([
      readLogs(),
      new Promise<string>((r) => setTimeout(() => r(''), LOGS_TIMEOUT))
    ]).catch(() => '');

  async function report() {
    if (!crash) return;
    const url = crashIssueUrl(crash, await logs());
    crash = null;
    await openUrl(url);
  }

  async function copy() {
    if (!crash) return;
    const text = `${crash.trim()}\n\n${await logs()}`;
    crash = null;
    try {
      await copyText(text);
      showSuccess('Crash report copied');
    } catch {
      showError('Could not copy the crash report');
    }
  }
</script>

{#if crash}
  <Modal label="Crash report" onclose={() => (crash = null)} class="max-w-sm bg-bg px-6 py-5">
    <p class="mb-2 text-sm font-bold">konigslibrary crashed last time</p>
    <p class="mb-5 text-sm leading-relaxed text-soft">
      Report it to help fix it. This opens a GitHub issue with the crash and the end of the logs;
      you see all of it before anything is sent.
    </p>
    <div class="flex justify-end gap-3">
      <button
        class="hit relative cursor-pointer border-2 px-4 py-2 text-sm text-dim hover:text-fg"
        onclick={() => (crash = null)}
      >
        Dismiss
      </button>
      <button
        class="hit relative cursor-pointer border-2 px-4 py-2 text-sm text-dim hover:text-fg"
        onclick={copy}
      >
        Copy
      </button>
      <button
        class="hit relative cursor-pointer border-2 bg-fg px-4 py-2 text-sm text-bg hover:bg-fg/80"
        onclick={report}
      >
        Report
      </button>
    </div>
  </Modal>
{/if}
