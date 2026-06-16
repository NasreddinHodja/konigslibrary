<script lang="ts">
  import { fly } from 'svelte/transition';
  import { X, Check, AlertTriangle } from 'lucide-svelte';
  import { getToasts, removeToast } from '$lib/ui/toast.svelte';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';

  const toasts = $derived(getToasts());
</script>

{#if toasts.length > 0}
  <div
    class="fixed right-4 z-50 flex flex-col gap-2"
    style="bottom: calc(1rem + var(--safe-bottom, 0px))"
  >
    {#each toasts as toast (toast.id)}
      <div
        class="flex min-w-72 items-start gap-3 border-2 bg-surface/70 px-4 py-3 shadow-lg backdrop-blur-2xl"
        in:fly={{ x: 100, duration: ANIM_DURATION, easing: ANIM_EASE }}
        out:fly={{ x: 100, duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
      >
        <div class="mt-0.5 shrink-0">
          {#if toast.phase === 'done'}
            <Check size={14} class="text-success" />
          {:else if toast.phase === 'error'}
            <AlertTriangle size={14} class="text-error" />
          {/if}
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-sm leading-snug">{toast.label}</span>
          {#if toast.phase === 'fetching'}
            <span class="text-xs tabular-nums opacity-50">{toast.current} / {toast.total}</span>
          {:else if toast.phase === 'deleting'}
            <span class="text-xs tabular-nums opacity-50"
              >Deleting… {toast.current} / {toast.total}</span
            >
          {:else if toast.phase === 'packaging'}
            <span class="text-xs opacity-50">Zipping…</span>
          {:else if toast.phase === 'done'}
            <span class="text-xs opacity-50">Done</span>
          {:else if toast.phase === 'error'}
            <span class="text-xs break-all opacity-50">{toast.errorMessage ?? 'Failed'}</span>
          {/if}
        </div>

        {#if toast.cancel}
          <button
            class="mt-1 shrink-0 cursor-pointer border border-border/20 px-2 py-0.5 text-xs opacity-50 hover:opacity-100"
            onclick={() => {
              toast.cancel?.();
              removeToast(toast.id);
            }}
          >
            Cancel
          </button>
        {:else if toast.phase === 'done' || toast.phase === 'error'}
          <button
            class="mt-0.5 shrink-0 opacity-60 hover:opacity-100"
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
