<script lang="ts">
  import { fly } from 'svelte/transition';
  import { X, Check, AlertTriangle } from 'lucide-svelte';
  import { getToasts, removeToast } from '$lib/ui/toast.svelte';
  import { ANIM_DURATION } from '$lib/utils/constants';

  const toasts = $derived(getToasts());
</script>

{#if toasts.length > 0}
  <div class="fixed right-4 z-50 flex flex-col gap-2" style="bottom: calc(1rem + var(--safe-bottom, 0px))">
    {#each toasts as toast (toast.id)}
      <div
        class="flex min-w-72 items-start gap-3 border-2 bg-black px-4 py-3 shadow-lg"
        transition:fly={{ x: 100, duration: ANIM_DURATION }}
      >
        <div class="mt-0.5 shrink-0">
          {#if toast.phase === 'done'}
            <Check size={14} class="text-green-400" />
          {:else if toast.phase === 'error'}
            <AlertTriangle size={14} class="text-red-400" />
          {/if}
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-sm leading-snug">{toast.label}</span>
          {#if toast.phase === 'fetching'}
            <span class="text-xs tabular-nums opacity-50">{toast.current} / {toast.total}</span>
          {:else if toast.phase === 'packaging'}
            <span class="text-xs opacity-50">Zipping…</span>
          {:else if toast.phase === 'done'}
            <span class="text-xs opacity-50">Done</span>
          {:else if toast.phase === 'error'}
            <span class="text-xs opacity-50">Failed</span>
          {/if}
        </div>

        {#if toast.cancel}
          <button
            class="mt-0.5 shrink-0 opacity-40 hover:opacity-100"
            onclick={() => {
              toast.cancel?.();
              removeToast(toast.id);
            }}
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        {:else if toast.phase === 'done' || toast.phase === 'error'}
          <button
            class="mt-0.5 shrink-0 opacity-40 hover:opacity-100"
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
