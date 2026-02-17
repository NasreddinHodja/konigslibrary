<script lang="ts">
  import Button from '$lib/ui/Button.svelte';
  import { apiUrl } from '$lib/constants';

  let mangaDir = $state('');
  let saved = $state(false);
  let error: string | null = $state(null);
  let loading = $state(true);

  $effect(() => {
    fetch(apiUrl('/api/settings'))
      .then((r) => r.json())
      .then((data: { mangaDir?: string }) => {
        mangaDir = data.mangaDir || '';
        loading = false;
      })
      .catch(() => {
        error = 'Could not load settings';
        loading = false;
      });
  });

  const save = async () => {
    saved = false;
    error = null;
    try {
      const res = await fetch(apiUrl('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaDir })
      });
      if (!res.ok) throw new Error();
      saved = true;
    } catch {
      error = 'Failed to save settings';
    }
  };
</script>

<div class="w-full max-w-md space-y-3">
  <h3 class="text-sm font-bold opacity-80">Manga directory</h3>
  {#if loading}
    <p class="text-sm opacity-40">Loading...</p>
  {:else}
    <input
      type="text"
      bind:value={mangaDir}
      placeholder="/path/to/manga"
      class="w-full border-2 bg-black px-3 py-2 text-sm text-white placeholder:opacity-40"
    />
    <div class="flex items-center gap-3">
      <Button size="md" onclick={save}>Save</Button>
      {#if saved}
        <span class="text-sm opacity-60">Saved — reload to see library</span>
      {/if}
      {#if error}
        <span class="text-sm text-red-400">{error}</span>
      {/if}
    </div>
  {/if}
</div>
