<script lang="ts">
  import Button from '$lib/ui/Button.svelte';
  import QrCode from '$lib/ui/QrCode.svelte';
  import { Copy } from 'lucide-svelte';
  import { getMangaDir } from '$lib/sources/native-library';
  import { startLanServer, stopLanServer, getLanServerStatus } from '$lib/sources/lan-server';

  let status = $state<'idle' | 'starting' | 'running' | 'stopping' | 'error'>('idle');
  let url = $state<string | null>(null);
  let error: string | null = $state(null);
  let copied = $state(false);

  const deepLink = $derived.by(() => {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return `konigslibrary://connect?host=${parsed.hostname}&port=${parsed.port}`;
    } catch {
      return '';
    }
  });

  $effect(() => {
    getLanServerStatus()
      .then((s) => {
        if (s.running && s.url) {
          status = 'running';
          url = s.url;
        }
      })
      .catch(() => {});
  });

  async function toggle() {
    if (status === 'running') {
      status = 'stopping';
      try {
        await stopLanServer();
      } catch {
        // fall through — status still reflects "not running" below
      }
      status = 'idle';
      url = null;
      return;
    }

    const mangaDir = getMangaDir();
    if (!mangaDir) {
      error = 'Set a local directory above first';
      status = 'error';
      return;
    }

    status = 'starting';
    error = null;
    try {
      const result = await startLanServer(mangaDir);
      url = result.url;
      status = 'running';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not start server';
      status = 'error';
    }
  }

  async function copyUrl() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="space-y-3">
  <h3 class="text-sm font-bold opacity-60">Share to LAN</h3>
  <Button size="md" onclick={toggle} disabled={status === 'starting' || status === 'stopping'}>
    {#if status === 'running'}
      Stop sharing
    {:else if status === 'starting'}
      Starting…
    {:else if status === 'stopping'}
      Stopping…
    {:else}
      Share to LAN
    {/if}
  </Button>

  {#if status === 'error' && error}
    <p class="text-sm text-error">{error}</p>
  {/if}

  {#if status === 'running' && url}
    <div class="flex flex-col items-start gap-3 border-2 border-border/15 p-4 sm:flex-row">
      <QrCode data={deepLink} size={160} />
      <div class="space-y-2 text-sm">
        <p class="opacity-60">Scan with your phone's camera app to connect.</p>
        <div class="flex items-center gap-2">
          <code class="border-2 bg-bg px-2 py-1 text-xs">{url}</code>
          <button
            class="border-2 p-1.5 opacity-60 hover:opacity-100"
            onclick={copyUrl}
            aria-label="Copy server URL"
          >
            <Copy size={14} />
          </button>
          {#if copied}
            <span class="text-xs opacity-60">Copied</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
