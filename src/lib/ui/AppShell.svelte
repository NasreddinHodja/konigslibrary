<script lang="ts">
  import Icon from './Icon.svelte';
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { backOrHome } from '$lib/ui/back';
  import UploadButton from '$lib/browsers/UploadButton.svelte';
  import { getReaderContext } from '$lib/context';

  let {
    active,
    isDragOver = false,
    children
  }: {
    active: 'library' | 'settings';
    isDragOver?: boolean;
    children: Snippet;
  } = $props();

  const reader = getReaderContext();

  const ITEM =
    'flex cursor-pointer flex-col items-center justify-center gap-1 border border-ink py-1 leading-4';
  const CURRENT = 'bg-ink text-bg';
  const IDLE = 'text-ink hover:bg-ink3 hover:text-hi';

  // On the library page, closing the manga is enough: its history entry pops
  // itself. Elsewhere this leaves settings the way its back does.
  function goLibrary() {
    reader.clearManga();
    if (page.url.pathname !== '/') backOrHome();
  }

  // Android pans the window under the keyboard (adjustPan), which would leave the
  // fixed tab bar floating mid-screen - hide it while text entry has focus instead.
  let typing = $state(false);

  function isTextEntry(el: EventTarget | null): boolean {
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color'].includes(
      el.type
    );
  }

  // Android only (MainActivity): the keyboard closed without its field losing
  // focus, as with system back. Blurring it brings the tab bar back, and the
  // next tap on the field focuses it again, so the bar hides again too.
  $effect(() => {
    const onIme = (e: Event) => {
      const el = document.activeElement;
      if (!(e as CustomEvent<boolean>).detail && isTextEntry(el)) (el as HTMLElement).blur();
    };
    window.addEventListener('nativeime', onIme);
    return () => window.removeEventListener('nativeime', onIme);
  });
</script>

<svelte:document
  onfocusin={(e) => (typing = isTextEntry(e.target))}
  onfocusout={(e) => (typing = isTextEntry(e.relatedTarget))}
/>

<!--
  Rail/tab bar are fixed overlay chrome, not layout siblings, so each page keeps
  scrolling exactly how it already did (some rely on window-level scroll for a
  virtualizer) - pages just reserve space for the chrome via padding.
-->
<nav
  class="nav-rail fixed top-0 bottom-0 left-0 z-20 hidden w-24 flex-col gap-2 border-r border-ink bg-bg p-2 md:flex"
  style="padding-top: calc(0.5rem + var(--safe-top)); padding-bottom: calc(0.5rem + var(--safe-bottom))"
>
  {@render items('')}
  <div class="flex-1"></div>
  <UploadButton {isDragOver} rail />
</nav>

<!-- Set 12px in from the sides and bottom, so a screen's rounded corners don't
     clip the outer boxes. -->
<nav
  class="nav-tabs fixed inset-x-0 bottom-0 z-20 flex items-stretch gap-2 border-t border-ink bg-bg px-3 pt-2 md:hidden {typing
    ? 'hidden'
    : ''}"
  style="height: calc(4.75rem + var(--safe-bottom)); padding-bottom: calc(0.75rem + var(--safe-bottom))"
>
  {@render items('flex-1', true)}
</nav>

<!-- The rail stacks library and settings; the tab bar puts upload between. -->
{#snippet items(size: string, withUpload = false)}
  <button
    type="button"
    onclick={goLibrary}
    aria-current={active === 'library' ? 'page' : undefined}
    class="{ITEM} {size} {active === 'library' ? CURRENT : IDLE}"
  >
    <Icon name="library" />
    library
  </button>
  {#if withUpload}<UploadButton {isDragOver} tab />{/if}
  <a
    href="/settings"
    aria-current={active === 'settings' ? 'page' : undefined}
    class="{ITEM} {size} {active === 'settings' ? CURRENT : IDLE}"
  >
    <Icon name="settings" />
    settings
  </a>
{/snippet}

<!-- Backs the status bar, so content scrolling up passes under it and pinned
     list bars (ListPanel) read as one with it. -->
<div
  class="pointer-events-none fixed inset-x-0 top-0 z-30 bg-bg"
  style="height: var(--safe-top)"
></div>

{@render children()}
