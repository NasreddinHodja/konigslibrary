<script lang="ts">
  import Icon from './Icon.svelte';
  import { fadeOut } from '$lib/ui/transitions';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EASE } from '$lib/utils/constants';
  import { getReaderContext } from '$lib/context';

  let { ondismiss }: { ondismiss: () => void } = $props();

  const reader = getReaderContext();
  const { state: manga } = reader;

  const leftLabel = $derived(manga.rtl ? 'next page' : 'previous page');
  const rightLabel = $derived(manga.rtl ? 'previous page' : 'next page');
  const leftArrow = $derived(manga.rtl ? 'next' : 'back');
  const rightArrow = $derived(manga.rtl ? 'back' : 'next');
</script>

<!-- An overlay on the page: a tint it shows through, and the tap zones as
     dashed outlines, edge to edge as the reader splits the screen. -->
<div
  class="fixed inset-0 z-50 flex flex-col"
  style:background="color-mix(in srgb, var(--color-bg) 70%, transparent)"
  role="button"
  tabindex="0"
  aria-label="Dismiss tutorial"
  onclick={ondismiss}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && ondismiss()}
  {@attach (node) => node.focus()}
  in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
  out:fadeOut
>
  {#if !manga.scrollMode}
    <div class="pointer-events-none flex flex-1">
      <div
        class="flex w-[40%] flex-col items-center justify-center gap-2 border border-dashed border-ink text-center"
      >
        <span class="text-ink"><Icon name={leftArrow} size={48} /></span>
        <span>{leftLabel}</span>
      </div>

      <div
        class="flex w-[20%] flex-col items-center justify-center gap-2 border-y border-dashed border-ink text-center"
      >
        <span>menu</span>
        <span class="text-dim">or swipe to turn</span>
      </div>

      <div
        class="flex w-[40%] flex-col items-center justify-center gap-2 border border-dashed border-ink text-center"
      >
        <span class="text-ink"><Icon name={rightArrow} size={48} /></span>
        <span>{rightLabel}</span>
      </div>
    </div>
  {:else}
    <div
      class="pointer-events-none flex flex-1 flex-col items-center justify-center gap-2 border border-dashed border-ink text-center"
    >
      <span>tap anywhere for the menu</span>
      <span class="text-dim">scroll to read on</span>
    </div>
  {/if}

  <p
    class="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 bg-ink px-2 text-bg"
    style="margin-bottom: var(--safe-bottom)"
  >
    tap anywhere to dismiss
  </p>
</div>
