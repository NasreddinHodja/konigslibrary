<script lang="ts">
  import { fly } from 'svelte/transition';
  import { X, Check, AlertTriangle } from 'lucide-svelte';
  import { getToasts, removeToast } from '$lib/ui/toast.svelte';
  import { ANIM_DURATION } from '$lib/utils/constants';

  const toasts = $derived(getToasts());
</script>

{#if toasts.length > 0}
  <div class="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
    {#each toasts as toast (toast.id)}
      <div
        class="flex items-center gap-3 border-2 bg-black px-4 py-2 shadow-lg"
        transition:fly={{ x: 100, duration: ANIM_DURATION }}
      >
        {#if toast.phase === 'done'}
          <Check size={16} class="shrink-0 text-green-400" />
        {:else if toast.phase === 'error'}
          <AlertTriangle size={16} class="shrink-0 text-red-400" />
        {/if}

        <span class="max-w-48 truncate text-sm">{toast.label}</span>

        {#if toast.phase === 'fetching' || toast.phase === 'packaging'}
          <span class="text-sm tabular-nums opacity-60">
            {#if toast.phase === 'packaging'}
              Zipping…
            {:else}
              {toast.current}/{toast.total}
            {/if}
          </span>
        {:else if toast.phase === 'done'}
          <span class="text-sm opacity-60">Done</span>
        {:else if toast.phase === 'error'}
          <span class="text-sm opacity-60">Failed</span>
        {/if}

        {#if toast.cancel}
          <button
            class="shrink-0 p-1 opacity-60 hover:opacity-100"
            onclick={() => {
              toast.cancel?.();
              removeToast(toast.id);
            }}
            aria-label="Cancel download"
          >
            <X size={14} />
          </button>
        {:else if toast.phase === 'done' || toast.phase === 'error'}
          <button
            class="shrink-0 p-1 opacity-60 hover:opacity-100"
            onclick={() => removeToast(toast.id)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
