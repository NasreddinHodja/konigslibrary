<script lang="ts">
  import { onDestroy } from 'svelte';
  import './layout.css';
  import favicon from '$lib/assets/favicon.svg';
  import { readerActive } from '$lib/ui/reader-active.svelte';
  import { initTheme } from '$lib/theme';
  import { createReader, setReaderContext } from '$lib/context';
  import { isAndroid, isNative } from '$lib/utils/platform';
  import { afterNavigate, goto, onNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import CrashReport from '$lib/ui/CrashReport.svelte';
  import { logWebviewErrors } from '$lib/utils/diagnostics';
  import { sessionLost } from '$lib/api/auth.svelte';

  let { children } = $props();

  // The server turned a request away for want of a session.
  $effect(() => {
    if (sessionLost() && page.url.pathname !== '/login') goto('/login');
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

  // The app's log gets the page's uncaught errors too, for "Copy logs".
  $effect(() => {
    if (isNative()) return logWebviewErrors();
  });
</script>

<svelte:document oncontextmenu={onContextMenu} />

<svelte:head>
  <title>konigslibrary</title>
  <link rel="icon" href={favicon} />
</svelte:head>
{#if !readerActive.value}
  <div class="fixed top-0 right-0 left-0 z-9998 bg-bg" style="height: var(--safe-top)"></div>
{/if}
{@render children()}
<CrashReport />
