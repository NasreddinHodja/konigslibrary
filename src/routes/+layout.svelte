<script lang="ts">
  import { onDestroy } from 'svelte';
  import './layout.css';
  import favicon from '$lib/assets/favicon.svg';
  import { readerActive } from '$lib/ui/reader-active.svelte';
  import { initTheme } from '$lib/theme';
  import { createReader, setReaderContext } from '$lib/context';
  import { isAndroid, isNative } from '$lib/utils/platform';
  import { showSuccess, showError } from '$lib/ui/toast.svelte';
  import { errorMessage } from '$lib/utils/errors';
  import { parseConnectLink, validateAndConnect } from '$lib/sources/server-connect';
  import { isLocalServer, setServerKey } from '$lib/utils/constants';
  import { afterNavigate, goto, onNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';

  let { children } = $props();

  // A device opening the server's `/?key=…` link stores the key before any
  // page asks the server for anything, then drops it from the address bar.
  const linkKey = isLocalServer ? new URL(location.href).searchParams.get('key') : null;
  if (linkKey) setServerKey(linkKey);
  $effect(() => {
    if (!linkKey) return;
    const url = new URL(location.href);
    url.searchParams.delete('key');
    replaceState(url, page.state);
  });

  const reader = createReader();
  setReaderContext(reader);
  onDestroy(() => reader.plugins.destroy());

  $effect(() => {
    initTheme();
  });

  // A long press on touch is the app's: outside text fields it opens no
  // browser menu or selection (which only buzzed, showing nothing). The mouse
  // keeps its right-click menu.
  function onContextMenu(e: MouseEvent) {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const el = e.target;
    if (el instanceof HTMLElement && el.closest('input, textarea, [contenteditable]')) return;
    e.preventDefault();
  }

  // Crossfades between pages. Browsers without view transitions just navigate.
  // The Linux app's WebKitGTK segfaults on startViewTransition, so it just navigates.
  const webKitGtk = isNative() && !isAndroid() && /Linux/.test(navigator.userAgent);
  onNavigate((navigation) => {
    if (!document.startViewTransition || webKitGtk) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  // Marks entries the app navigated to, so their back can return into it
  // (backOrHome) rather than leave.
  afterNavigate(({ type }) => {
    if (type === 'link' || type === 'goto') replaceState('', { ...page.state, fromApp: true });
  });

  async function handleDeepLink(raw: string) {
    const link = parseConnectLink(raw);
    if (!link) return;
    try {
      await validateAndConnect(link.url, link.key);
      showSuccess('Connected via QR code');
      goto('/');
    } catch (e) {
      showError(errorMessage(e, 'Could not connect'));
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

<svelte:document oncontextmenu={onContextMenu} />

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !readerActive.value}
  <div class="fixed top-0 right-0 left-0 z-9998 bg-bg" style="height: var(--safe-top)"></div>
{/if}
{@render children()}
