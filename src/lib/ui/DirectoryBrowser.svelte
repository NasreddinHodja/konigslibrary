<script lang="ts">
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import Skeleton from './Skeleton.svelte';
  import { errorMessage } from '$lib/utils/errors';
  import { apiFetch } from '$lib/api/auth.svelte';

  let {
    initialPath,
    onselect,
    oncancel
  }: {
    initialPath?: string;
    onselect: (path: string) => void;
    oncancel: () => void;
  } = $props();

  type Entry = { name: string; path: string };

  let path = $state('');
  let entries: Entry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  const segments = $derived.by(() => {
    if (!path) return [];
    const parts = path.split('/').filter(Boolean);
    let acc = '';
    const result: Entry[] = [{ name: '/', path: '/' }];
    for (const part of parts) {
      acc += '/' + part;
      result.push({ name: part, path: acc });
    }
    return result;
  });

  // Only the latest request may write, so a slow older one can't win.
  let latestLoad = 0;

  async function load(target: string = '') {
    const req = ++latestLoad;
    loading = true;
    error = null;
    try {
      const qs = target ? `?path=${encodeURIComponent(target)}` : '';
      const res = await apiFetch(`/api/settings/browse${qs}`);
      const data = await res.json();
      if (req !== latestLoad) return;
      if (!res.ok) throw new Error(data.error || `${res.status}`);
      path = data.path;
      entries = data.entries;
    } catch (e) {
      if (req !== latestLoad) return;
      error = errorMessage(e, 'Could not browse directory');
    }
    loading = false;
  }

  $effect(() => {
    load(initialPath);
  });

  $effect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  });
</script>

<Modal
  label="Browse for manga directory"
  onclose={oncancel}
  class="my-8 flex h-[60vh] max-w-lg flex-col"
>
  <div class="flex shrink-0 items-center justify-between border-b border-ink px-3 py-2">
    <span>choose manga folder</span>
    <button
      class="hit relative flex cursor-pointer items-center justify-center text-ink hover:text-hi"
      onclick={oncancel}
      aria-label="Close"
    >
      <Icon name="close" />
    </button>
  </div>

  <div class="flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-2 whitespace-nowrap">
    {#each segments as seg, i (seg.path)}
      {#if i > 0}<span class="shrink-0 text-dim">/</span>{/if}
      {#if i === segments.length - 1}
        <span class="shrink-0">{seg.name}</span>
      {:else}
        <button
          class="shrink-0 cursor-pointer text-ink hover:text-hi hover:underline pointer-coarse:py-3"
          onclick={() => load(seg.path)}
        >
          {seg.name}
        </button>
      {/if}
    {/each}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-ink">
    {#if loading}
      <div class="flex flex-col gap-2 p-3">
        {#each [180, 140, 210] as w (w)}
          <Skeleton class="h-4" style="width: {w}px" />
        {/each}
      </div>
    {:else if error}
      <p class="p-3 text-ink">► <span>{error}</span></p>
    {:else if entries.length > 0}
      {#each entries as entry (entry.path)}
        <button
          class="flex w-full cursor-pointer items-center gap-2 border-b border-ink3 px-3 py-1 text-left text-ink hover:bg-ink3 hover:text-hi pointer-coarse:py-3"
          onclick={() => load(entry.path)}
        >
          <Icon name="folder" />
          <span class="truncate">{entry.name}/</span>
        </button>
      {/each}
    {:else}
      <p class="p-3 text-dim">No subdirectories</p>
    {/if}
  </div>

  <div class="flex shrink-0 items-center justify-between gap-3 px-3 py-3">
    <p class="min-w-0 truncate text-dim" title={path}>{path}</p>
    <div class="flex shrink-0 gap-3">
      <Button onclick={oncancel}>cancel</Button>
      <Button variant="primary" disabled={loading || !!error} onclick={() => onselect(path)}>
        use this folder
      </Button>
    </div>
  </div>
</Modal>
