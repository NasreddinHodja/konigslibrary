<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';
  import { FolderOpen, Folder, ChevronRight, X, Loader2 } from 'lucide-svelte';
  import Backdrop from './Backdrop.svelte';
  import Button from './Button.svelte';
  import Skeleton from './Skeleton.svelte';

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

  async function load(target: string = '') {
    loading = true;
    error = null;
    try {
      const qs = target ? `?path=${encodeURIComponent(target)}` : '';
      const res = await fetch(`/api/settings/browse${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${res.status}`);
      path = data.path;
      entries = data.entries;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not browse directory';
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

<Backdrop onclick={oncancel} />
<div
  class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Browse for manga directory"
>
  <div
    class="pointer-events-auto my-8 flex max-h-[80vh] w-full max-w-lg flex-col border-2 bg-bg"
    in:fly={{ y: 10, duration: ANIM_DURATION, easing: ANIM_EASE }}
    out:fade={{ duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
  >
    <div class="flex shrink-0 items-center justify-between border-b border-border/10 px-5 py-4">
      <div class="flex items-center gap-2 text-sm font-bold tracking-wide">
        <FolderOpen size={16} class="opacity-60" />
        Choose manga folder
      </div>
      <button
        class="cursor-pointer opacity-50 hover:opacity-90"
        onclick={oncancel}
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>

    <div
      class="flex shrink-0 items-center gap-1 overflow-x-auto px-5 py-3 text-xs whitespace-nowrap"
    >
      {#each segments as seg, i (seg.path)}
        {#if i > 0}<ChevronRight size={11} class="shrink-0 opacity-30" />{/if}
        {#if i === segments.length - 1}
          <span class="shrink-0 font-bold opacity-90">{seg.name}</span>
        {:else}
          <button
            class="shrink-0 cursor-pointer opacity-50 hover:text-fg hover:opacity-100"
            onclick={() => load(seg.path)}
          >
            {seg.name}
          </button>
        {/if}
      {/each}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-border/10 px-2">
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
              class="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-fg/5"
              onclick={() => load(entry.path)}
            >
              <Folder size={15} class="shrink-0 opacity-40" />
              <span class="truncate">{entry.name}</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="px-3 py-3 text-sm opacity-50">No subdirectories</p>
      {/if}
    </div>

    <div class="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
      <p class="min-w-0 truncate text-xs opacity-40" title={path}>{path}</p>
      <div class="flex shrink-0 gap-3">
        <button
          class="cursor-pointer border-2 px-4 py-2 text-sm opacity-60 hover:opacity-100"
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
  </div>
</div>
