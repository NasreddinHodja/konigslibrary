<script lang="ts">
  import Button from '$lib/ui/Button.svelte';

  let mangaDir = $state('');
  let saved = $state(false);
  let loading = $state(true);

  $effect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        mangaDir = data.mangaDir || '';
        loading = false;
      })
      .catch(() => {
        loading = false;
      });
  });

  const save = async () => {
    saved = false;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaDir })
    });
    saved = true;
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
    </div>
  {/if}
</div>
