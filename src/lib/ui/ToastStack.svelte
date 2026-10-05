<script lang="ts">
  import Icon from './Icon.svelte';
  import { fly } from 'svelte/transition';
  import Spinner from './Spinner.svelte';
  import { getToasts, removeToast, areDownloadsFolded, type Toast } from '$lib/ui/toast.svelte';
  import {
    downloadProgress,
    activeDownloads,
    cancelAllDownloads
  } from '$lib/sources/download.svelte';
  import { ANIM_DURATION, ANIM_EXIT_DURATION, ANIM_EASE, ANIM_EASE_IN } from '$lib/utils/constants';

  const FOLDED_ID = 'download-group';

  const toasts = $derived(getToasts());
  const downloads = $derived(toasts.filter((t) => t.group === 'download'));
  const running = $derived(downloads.filter((t) => t.phase === 'fetching'));

  const folded = $derived(areDownloadsFolded());
  /// The toasts as shown: while folded, every download toast is one toast in
  /// the first one's place, for all manga downloading or queued, adding up
  /// every running download's chapter counts, dismissed toasts' too. Its
  /// cancel stops every download; close hides all it holds.
  const shown: { toast: Toast; dismiss: () => void }[] = $derived.by(() => {
    const each = (t: Toast) => ({ toast: t, dismiss: () => removeToast(t.id) });
    if (!folded || downloads.length === 0) return toasts.map(each);

    const active = [...activeDownloads.values()];
    const failed = downloads.filter((t) => t.phase === 'error').length;
    const summary: Toast =
      running.length > 0
        ? {
            id: FOLDED_ID,
            label: `Downloading ${downloadProgress.size} manga`,
            current: active.reduce((n, d) => n + d.current, 0),
            total: active.reduce((n, d) => n + d.total, 0),
            phase: 'fetching',
            cancel: cancelAllDownloads
          }
        : {
            id: FOLDED_ID,
            label: 'Downloads finished',
            current: 0,
            total: 0,
            phase: failed ? 'error' : 'done',
            errorMessage: `${failed} failed`
          };
    const dismissAll = () => downloads.forEach((t) => removeToast(t.id));
    return toasts.flatMap((t) =>
      t === downloads[0]
        ? [{ toast: summary, dismiss: dismissAll }]
        : t.group === 'download'
          ? []
          : [each(t)]
    );
  });
  /// Progress as the font's blocks: █ done, ░ to go.
  function bar(done: number, total: number, width = 12) {
    const n = total ? Math.round((Math.min(done, total) / total) * width) : 0;
    return '█'.repeat(n) + '░'.repeat(width - n);
  }
</script>

<!-- Always rendered: transitions are local, so toasts inside an {#if} on the
     list would skip their fly when the first appears or the last goes. -->
<div
  class="fixed right-4 z-50 flex flex-col gap-2"
  style="bottom: calc(1rem + var(--safe-bottom, 0px))"
>
  {#each shown as { toast, dismiss } (toast.id)}
    <div
      class="flex min-w-72 items-start gap-3 panel px-3 py-2"
      in:fly={{
        x: 100,
        duration: ANIM_DURATION,
        easing: ANIM_EASE,
        // The folded toast comes in once the ones it replaces are out.
        delay: toast.id === FOLDED_ID ? ANIM_EXIT_DURATION : 0
      }}
      out:fly={{ x: 100, duration: ANIM_EXIT_DURATION, easing: ANIM_EASE_IN }}
    >
      <!-- Every toast has the mark's slot, so labels line up down the stack. -->
      <span class="flex size-6 shrink-0 items-center justify-center text-ink">
        {#if toast.phase === 'done'}<Icon
            name="check"
          />{:else if toast.phase === 'error'}►{:else}<Spinner />{/if}
      </span>

      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <!-- Close and Cancel end each line at the same right edge. -->
        <div class="flex items-start justify-between gap-3">
          <span>{toast.label}</span>
          <!-- Hides the toast; whatever it reports carries on. -->
          <button
            class="hit relative flex shrink-0 cursor-pointer items-center justify-center text-ink hover:text-hi"
            onclick={dismiss}
            aria-label="Dismiss"
          >
            <Icon name="close" />
          </button>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          {#if toast.phase === 'fetching' && (toast.id === FOLDED_ID || toast.group === 'download')}
            <span class="tabular-nums"
              ><span class="text-ink">{bar(toast.current, toast.total)}</span>
              <span class="text-dim">{toast.current} / {toast.total} chapters</span></span
            >
          {:else if toast.phase === 'fetching'}
            <span class="text-dim tabular-nums">{toast.current} / {toast.total}</span>
          {:else if toast.phase === 'deleting'}
            <span class="text-dim tabular-nums">Deleting… {toast.current} / {toast.total}</span>
          {:else if toast.phase === 'packaging'}
            <span class="text-dim">Zipping…</span>
          {:else if toast.phase === 'done'}
            <span class="text-dim">Done</span>
          {:else if toast.phase === 'error'}
            <span class="break-all text-dim">{toast.errorMessage ?? 'Failed'}</span>
          {/if}
          {#if toast.cancel}
            <button
              class="hit relative shrink-0 cursor-pointer text-ink hover:text-hi hover:underline"
              onclick={() => {
                toast.cancel?.();
                dismiss();
              }}
            >
              cancel
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/each}
</div>
