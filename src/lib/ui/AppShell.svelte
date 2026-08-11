<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { LibraryBig, Settings } from 'lucide-svelte';
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

  function goLibrary() {
    reader.clearManga();
    goto('/');
  }
</script>

<!--
  Rail/tab bar are fixed overlay chrome, not layout siblings, so each page keeps
  scrolling exactly how it already did (some rely on window-level scroll for a
  virtualizer) - pages just reserve space for the chrome via padding.
-->
<nav
  class="fixed top-0 bottom-0 left-0 z-20 hidden w-14 flex-col items-center border-r border-border/10 bg-bg py-4 md:flex"
  style="padding-top: calc(1rem + var(--safe-top)); padding-bottom: calc(1rem + var(--safe-bottom))"
>
  <button
    type="button"
    onclick={goLibrary}
    aria-label="Home"
    class="flex h-7 w-7 cursor-pointer items-center justify-center border-2 border-fg text-xs font-bold hover:bg-fg hover:text-bg"
  >
    K
  </button>

  <div class="flex flex-1 flex-col items-center justify-center gap-7">
    <button
      type="button"
      onclick={goLibrary}
      class="flex cursor-pointer flex-col items-center gap-1.5"
    >
      <div
        class="flex h-8 w-8 items-center justify-center {active === 'library'
          ? 'bg-fg text-bg'
          : 'opacity-50 hover:bg-fg/10 hover:opacity-90'}"
      >
        <LibraryBig size={15} />
      </div>
      <span class="text-[0.55rem] font-bold tracking-wide uppercase opacity-70">Library</span>
    </button>

    <a href="/settings" class="flex flex-col items-center gap-1.5">
      <div
        class="flex h-8 w-8 items-center justify-center {active === 'settings'
          ? 'bg-fg text-bg'
          : 'opacity-50 hover:bg-fg/10 hover:opacity-90'}"
      >
        <Settings size={15} />
      </div>
      <span class="text-[0.55rem] font-bold tracking-wide uppercase opacity-70">Settings</span>
    </a>
  </div>

  <UploadButton {isDragOver} iconOnly />
</nav>

<nav
  class="fixed inset-x-0 bottom-0 z-20 flex items-center border-t border-border/10 bg-bg px-2 md:hidden"
  style="height: calc(3.75rem + var(--safe-bottom)); padding-bottom: var(--safe-bottom)"
>
  <button
    type="button"
    onclick={goLibrary}
    class="flex flex-1 cursor-pointer flex-col items-center gap-1 {active === 'library'
      ? ''
      : 'opacity-50 hover:opacity-90'}"
  >
    <LibraryBig size={16} />
    <span class="text-[0.6rem] font-bold tracking-wide uppercase">Library</span>
  </button>

  <div class="flex flex-1 flex-col items-center gap-1">
    <div class="-mt-5">
      <UploadButton {isDragOver} iconOnly />
    </div>
    <span class="text-[0.6rem] font-bold tracking-wide uppercase opacity-50">Upload</span>
  </div>

  <a
    href="/settings"
    class="flex flex-1 flex-col items-center gap-1 {active === 'settings'
      ? ''
      : 'opacity-50 hover:opacity-90'}"
  >
    <Settings size={16} />
    <span class="text-[0.6rem] font-bold tracking-wide uppercase">Settings</span>
  </a>
</nav>

{@render children()}
