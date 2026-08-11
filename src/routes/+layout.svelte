<script lang="ts">
  import { onDestroy } from 'svelte';
  import './layout.css';
  import favicon from '$lib/assets/favicon.svg';
  import { readerActive } from '$lib/ui/reader-active.svelte';
  import { initTheme } from '$lib/theme';
  import { createReader, setReaderContext } from '$lib/context';
  import { isNative } from '$lib/utils/platform';
  import { showSuccess, showError } from '$lib/ui/toast.svelte';
  import { validateAndConnect } from '$lib/sources/server-connect';
  import { goto } from '$app/navigation';

  let { children } = $props();

  const reader = createReader();
  setReaderContext(reader);
  onDestroy(() => reader.plugins.destroy());

  $effect(() => {
    initTheme();
  });

  function parseConnectUrl(raw: string): string | null {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'konigslibrary:' || parsed.hostname !== 'connect') return null;
      const host = parsed.searchParams.get('host');
      const port = parsed.searchParams.get('port');
      if (!host || !port) return null;
      return `http://${host}:${port}`;
    } catch {
      return null;
    }
  }

  async function handleDeepLink(raw: string) {
    const url = parseConnectUrl(raw);
    if (!url) return;
    try {
      await validateAndConnect(url);
      showSuccess('Connected via QR code');
      goto('/');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not connect');
    }
  }

  $effect(() => {
    if (!isNative()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/plugin-deep-link').then(async ({ getCurrent, onOpenUrl }) => {
      const initial = await getCurrent();
      if (initial?.[0]) handleDeepLink(initial[0]);
      unlisten = await onOpenUrl((urls) => {
        if (urls[0]) handleDeepLink(urls[0]);
      });
    });
    return () => unlisten?.();
  });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !readerActive.value}
  <div class="fixed top-0 right-0 left-0 z-9998 bg-bg" style="height: var(--safe-top)"></div>
{/if}
{@render children()}
