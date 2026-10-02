<script lang="ts">
  import { FolderOpen, Folder, ChevronRight, X, Loader2 } from 'lucide-svelte';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import Skeleton from './Skeleton.svelte';
  import { errorMessage } from '$lib/utils/errors';

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
      const res = await fetch(`/api/settings/browse${qs}`);
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
  class="my-8 flex h-[60vh] max-w-lg flex-col bg-bg"
>
  <div class="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
    <div class="flex items-center gap-2 text-sm font-bold tracking-wide">
      <FolderOpen size={16} class="text-dim" />
      Choose manga folder
    </div>
    <button
      class="hit relative cursor-pointer text-dim hover:text-soft"
      onclick={oncancel}
      aria-label="Close"
    >
      <X size={16} />
    </button>
  </div>

  <div
    class="flex shrink-0 items-center gap-1 overflow-x-auto px-5 py-3 text-xs whitespace-nowrap pointer-coarse:py-0"
  >
    {#each segments as seg, i (seg.path)}
      {#if i > 0}<ChevronRight size={11} class="shrink-0 opacity-30" />{/if}
      {#if i === segments.length - 1}
        <span class="shrink-0 font-bold text-soft">{seg.name}</span>
      {:else}
        <button
          class="shrink-0 cursor-pointer text-dim hover:text-fg pointer-coarse:py-4"
          onclick={() => load(seg.path)}
        >
          {seg.name}
        </button>
      {/if}
    {/each}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-line px-2">
    {#if loading}
      <div class="space-y-1 py-3">
        {#each [180, 140, 210] as w (w)}
          <div class="flex items-center px-3 py-2">
            <Skeleton class="h-4" style="width: {w}px" />
          </div>
        {/each}
      </div>
    {:else if error}
      <p class="px-3 py-3 text-sm text-error">{error}</p>
    {:else if entries.length > 0}
      <div class="py-1">
        {#each entries as entry (entry.path)}
          <button
            class="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-fg/5 pointer-coarse:py-3.5"
            onclick={() => load(entry.path)}
          >
            <Folder size={15} class="shrink-0 text-faint" />
            <span class="truncate">{entry.name}</span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="px-3 py-3 text-sm text-dim">No subdirectories</p>
    {/if}
  </div>

  <div class="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
    <p class="min-w-0 truncate text-xs text-faint" title={path}>{path}</p>
    <div class="flex shrink-0 gap-3">
      <button
        class="hit relative cursor-pointer border-2 px-4 py-2 text-sm text-dim hover:text-fg"
        onclick={oncancel}
      >
        Cancel
      </button>
      <Button
        size="md"
        variant="primary"
        disabled={loading || !!error}
        onclick={() => onselect(path)}
      >
        {#if loading}<Loader2 size={14} class="animate-spin" />{/if}
        Use this folder
      </Button>
    </div>
  </div>
</Modal>
