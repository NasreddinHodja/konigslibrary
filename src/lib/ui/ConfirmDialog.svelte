<script lang="ts">
  import Modal from './Modal.svelte';

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

<Modal label="Confirm action" onclose={oncancel} class="max-w-sm bg-bg px-6 py-5">
  <p class="mb-5 text-sm leading-relaxed">{message}</p>
  <div class="flex justify-end gap-3">
    <button
      class="hit relative cursor-pointer border-2 px-4 py-2 text-sm text-dim hover:text-fg"
      onclick={oncancel}
    >
      Cancel
    </button>
    <button
      class="hit relative cursor-pointer border-2 bg-fg px-4 py-2 text-sm text-bg hover:bg-fg/80"
      onclick={onconfirm}
    >
      {confirmLabel}
    </button>
  </div>
</Modal>
