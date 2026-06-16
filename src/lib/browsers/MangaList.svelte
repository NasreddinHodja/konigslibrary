<script lang="ts">
  import { RefreshCw } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';

  type Entry = { id: string; name: string };

  let {
    title,
    entries,
    loading,
    error = null,
    onopen,
    onrefresh,
    action
  }: {
    title: string;
    entries: Entry[];
    loading: boolean;
    error?: string | null;
    onopen: (id: string) => void;
    onrefresh?: () => void;
    action?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      icon: any;
      onclick: (id: string) => void;
      loadingId?: string | null;
    };
  } = $props();
</script>

{#if loading}
  <div class="w-full min-w-0">
    <Skeleton class="mb-3 h-3 w-14" />
    {#each [180, 140, 210, 160] as w (w)}
      <div class="flex items-center border-b border-border/10 py-3.5">
        <Skeleton class="h-4" style="width: {w}px" />
      </div>
    {/each}
  </div>
{:else if error}
  <p class="text-xs opacity-60">{error}</p>
{:else if entries.length > 0}
  <div class="w-full min-w-0">
    <div class="mb-3 flex items-center gap-3">
      <p class="text-xs font-bold tracking-widest opacity-40">{title}</p>
      {#if onrefresh}
        <button
          class="cursor-pointer opacity-20 hover:opacity-70"
          onclick={onrefresh}
          aria-label="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      {/if}
    </div>
    <div>
      {#each entries as entry (entry.id)}
        <div
          class="flex items-center border-b border-border/10 first:border-t first:border-border/10"
        >
          <button
            class="flex min-w-0 flex-1 cursor-pointer py-3.5 text-left text-sm hover:opacity-70"
            onclick={() => onopen(entry.id)}
          >
            <span class="truncate">{entry.name}</span>
          </button>
          {#if action}
            <button
              class="shrink-0 py-3.5 pl-4 {action.loadingId === entry.id
                ? 'animate-pulse cursor-wait opacity-30'
                : 'cursor-pointer opacity-20 hover:opacity-70'}"
              onclick={(e) => {
                e.stopPropagation();
                action.onclick(entry.id);
              }}
              disabled={action.loadingId === entry.id}
              aria-label="{entry.name} action"
            >
              <action.icon size={14} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
