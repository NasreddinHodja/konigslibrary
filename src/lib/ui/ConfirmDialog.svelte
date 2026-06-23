<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import Backdrop from './Backdrop.svelte';

  let {
    message,
    confirmLabel = 'Confirm',
    onconfirm,
    oncancel
  }: {
    message: string;
    confirmLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();

  let dialogEl: HTMLDivElement | undefined = $state();
  let previousFocus: HTMLElement | null = null;

  const FOCUSABLE = 'a[href], button, [tabindex]:not([tabindex="-1"])';

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !dialogEl) return;
    const focusable = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!dialogEl) return;
    previousFocus = document.activeElement as HTMLElement | null;
    const first = dialogEl.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => previousFocus?.focus();
  });
</script>

<svelte:window onkeydown={trapFocus} />

<Backdrop onclick={oncancel} />
<div
  bind:this={dialogEl}
  class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Confirm action"
>
  <div
    class="pointer-events-auto w-full max-w-sm border-2 bg-bg px-6 py-5"
    in:fly={{ y: 10, duration: ANIM_DURATION, easing: ANIM_EASE }}
    out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
  >
    <p class="mb-5 text-sm leading-relaxed">{message}</p>
    <div class="flex justify-end gap-3">
      <button
        class="cursor-pointer border-2 px-4 py-2 text-sm opacity-60 hover:opacity-100"
        onclick={oncancel}
      >
        Cancel
      </button>
      <button
        class="cursor-pointer border-2 bg-fg px-4 py-2 text-sm text-bg hover:bg-fg/80"
        onclick={onconfirm}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
