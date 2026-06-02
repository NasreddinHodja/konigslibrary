<script lang="ts">
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import { getReaderContext } from '$lib/context';

  let { ondismiss }: { ondismiss: () => void } = $props();

  const svc = getReaderContext();
  const { state: manga } = svc;

  const leftLabel = $derived(manga.rtl ? 'NEXT PAGE' : 'PREV PAGE');
  const rightLabel = $derived(manga.rtl ? 'PREV PAGE' : 'NEXT PAGE');
  const leftArrow = $derived(manga.rtl ? '→' : '←');
  const rightArrow = $derived(manga.rtl ? '←' : '→');
</script>

<div
  class="fixed inset-0 z-50 flex flex-col bg-bg/80"
  role="button"
  tabindex="0"
  aria-label="Dismiss tutorial"
  onclick={ondismiss}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && ondismiss()}
  in:fade={{ duration: ANIM_DURATION, easing: ANIM_EASE }}
  out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
>
  {#if !manga.scrollMode}
    <div class="flex flex-1">
      <div class="flex w-[40%] items-center justify-center border border-dashed border-fg/20">
        <div class="pointer-events-none text-center">
          <div class="text-3xl opacity-50">{leftArrow}</div>
          <div class="mt-3 text-xs font-bold tracking-widest opacity-50">{leftLabel}</div>
        </div>
      </div>

      <div class="flex w-[20%] flex-col items-center justify-between py-12">
        <div class="pointer-events-none text-center">
          <div class="mx-auto mb-3 flex h-8 w-8 items-center justify-center border border-fg/30">
            <div class="h-1.5 w-1.5 rounded-full bg-fg/60"></div>
          </div>
          <div class="text-xs font-bold tracking-widest opacity-50">HUD</div>
        </div>

        <div class="pointer-events-none space-y-4 text-center">
          <div class="border border-dashed border-fg/15 px-3 py-1.5">
            <div class="text-xs font-bold tracking-widest opacity-30">CENTER ZONE</div>
          </div>

          <div class="opacity-40">
            <div class="flex items-center justify-center gap-3 text-sm">
              <span>←</span>
              <span class="text-xs font-bold tracking-widest">SWIPE</span>
              <span>→</span>
            </div>
            <div class="mt-1 text-xs tracking-widest opacity-70">TO TURN PAGES</div>
          </div>
        </div>

        <div class="invisible h-8"></div>
      </div>

      <div class="flex w-[40%] items-center justify-center border border-dashed border-fg/20">
        <div class="pointer-events-none text-center">
          <div class="text-3xl opacity-50">{rightArrow}</div>
          <div class="mt-3 text-xs font-bold tracking-widest opacity-50">{rightLabel}</div>
        </div>
      </div>
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center">
      <div class="pointer-events-none space-y-6 text-center">
        <div class="border border-dashed border-fg/20 px-8 py-6">
          <div class="mb-2 text-xs font-bold tracking-widest opacity-30">ANYWHERE</div>
          <div class="text-xs tracking-widest opacity-50">TAP TO TOGGLE HUD</div>
        </div>
        <div class="text-xs tracking-widest opacity-30">SCROLL TO NAVIGATE</div>
      </div>
    </div>
  {/if}

  <div class="pointer-events-none py-10 text-center">
    <div class="text-xs font-bold tracking-widest opacity-30">TAP ANYWHERE TO DISMISS</div>
  </div>
</div>
