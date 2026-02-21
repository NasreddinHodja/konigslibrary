<script lang="ts">
  import { getReaderContext } from '$lib/context';
  import { ZipUploadProvider } from '$lib/sources';
  import { showError } from '$lib/ui/toast.svelte';
  import Button from '$lib/ui/Button.svelte';

  const { setSource } = getReaderContext();
</script>

<label class="cursor-pointer">
  <Button size="lg" as="span">Upload manga</Button>
  <input
    type="file"
    accept=".zip,.cbz"
    onchange={async (e) => {
      const input = e.target as HTMLInputElement;
      if (!input.files?.[0]) return;
      try {
        await setSource(new ZipUploadProvider(input.files[0]));
      } catch (err) {
        showError(`Failed to open file: ${err instanceof Error ? err.message : err}`);
      }
    }}
    class="hidden"
  />
</label>
