<script lang="ts">
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';

  let {
    message,
    confirmLabel = 'confirm',
    onconfirm,
    oncancel
  }: {
    message: string;
    confirmLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<Modal label="Confirm action" onclose={oncancel} class="max-w-sm p-4">
  <p class="mb-4">{message}</p>
  <div class="flex justify-end gap-3">
    <Button onclick={oncancel}>cancel</Button>
    <Button variant="primary" onclick={onconfirm}>{confirmLabel}</Button>
  </div>
</Modal>
