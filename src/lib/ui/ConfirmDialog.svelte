<script lang="ts">
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
</script>

<Backdrop onclick={oncancel} />
<div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
  <div class="pointer-events-auto w-full max-w-sm border-2 bg-black px-6 py-5">
    <p class="mb-5 text-sm leading-relaxed">{message}</p>
    <div class="flex justify-end gap-3">
      <button
        class="cursor-pointer border-2 px-4 py-2 text-sm opacity-60 hover:opacity-100"
        onclick={oncancel}
      >
        Cancel
      </button>
      <button
        class="cursor-pointer border-2 bg-white px-4 py-2 text-sm text-black hover:bg-white/80"
        onclick={onconfirm}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
