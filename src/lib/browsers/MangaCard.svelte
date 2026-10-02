<script lang="ts">
  import { untrack, type ComponentType, type SvelteComponent } from 'svelte';
  import { Check, CloudCheck, type IconProps } from 'lucide-svelte';
  import { knownMeta, queueMeta } from './cover-queue';
  import type { CardMeta } from '$lib/api/meta';
  import CoverThumbnail from '$lib/ui/CoverThumbnail.svelte';
  import { hapticLongPress } from '$lib/utils/haptics';

  let {
    name,
    metaKey,
    loadMeta,
    ontitle,
    downloaded,
    action,
    progress = null,
    selection = null,
    disabled = false,
    onopen,
    onlongpress
  }: {
    name: string;
    /// Identifies this manga's metadata in the session cache.
    metaKey: string;
    loadMeta: () => Promise<CardMeta | null>;
    ontitle?: (title: string) => void;
    /// A server manga with a copy on this device (Server tab only: on the
    /// Device tab everything is on the device).
    downloaded: boolean;
    action?: {
      icon: ComponentType<SvelteComponent<IconProps>>;
      label: string;
      loading: boolean;
      onclick: () => void;
    } | null;
    /// Chapters copied so far while downloading; 0 of 0 while queued.
    progress?: { done: number; total: number } | null;
    /// In selection mode, whether this card is picked, or can't be.
    selection?: 'selected' | 'unselected' | 'disabled' | null;
    /// Can't be opened; its action button still works.
    disabled?: boolean;
    onopen: () => void;
    onlongpress?: () => void;
  } = $props();

  // A press held this long without moving is a long press. The click that
  // ends it is swallowed, so the card isn't also opened.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_SLOP = 10;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressStart: { x: number; y: number } | null = null;
  let longPressed = false;

  function startPress(e: PointerEvent) {
    if (!onlongpress || e.button !== 0) return;
    longPressed = false;
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      longPressed = true;
      pressStart = null;
      hapticLongPress();
      onlongpress?.();
    }, LONG_PRESS_MS);
  }

  function endPress() {
    clearTimeout(pressTimer);
    pressStart = null;
  }

  function movePress(e: PointerEvent) {
    if (
      pressStart &&
      Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > LONG_PRESS_SLOP
    )
      endPress();
  }

  // Read once: a Server-tab card's key does change when its download
  // completes (`server:` → `path:`), but it keeps the meta it already has.
  const hit = knownMeta(untrack(() => metaKey));

  let el: HTMLDivElement | undefined = $state();
  let cover: string | null = $state(hit?.coverUrl ?? null);
  let title: string | null = $state(hit?.title ?? null);
  let loading = $state(hit === undefined);
  let requested = hit !== undefined;

  $effect(() => {
    if (hit?.title) untrack(() => ontitle?.(hit.title!));
  });

  const displayName = $derived(title || name);

  $effect(() => {
    if (!el || requested) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || requested) return;
        requested = true;
        observer.disconnect();
        queueMeta(metaKey, loadMeta).then((meta) => {
          cover = meta?.coverUrl ?? null;
          title = meta?.title ?? null;
          if (title) ontitle?.(title);
          loading = false;
        });
      },
      { root: el.closest('[data-scroll-root]'), rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<!-- The long press is a shortcut for the library's Select button; the card's
     own button stays the control. -->
<div
  bind:this={el}
  role="group"
  class="transition-opacity {selection === 'disabled' ? 'opacity-40' : ''}"
  onpointerdown={startPress}
  onpointermove={movePress}
  onpointerup={endPress}
  onpointercancel={endPress}
  onpointerleave={endPress}
  onclickcapture={(e) => {
    if (!longPressed) return;
    longPressed = false;
    e.stopPropagation();
    e.preventDefault();
  }}
  oncontextmenu={(e) => onlongpress && e.preventDefault()}
>
  <CoverThumbnail
    src={cover}
    caption={displayName}
    alt="Open {displayName}"
    {loading}
    {disabled}
    active={selection === 'selected'}
    onclick={onopen}
  >
    {#snippet overlay()}
      {#if progress}
        <!-- Downloading: a bar along the top that only fills up. While the
             count isn't known yet (queued, listing chapters) it's empty and
             the track pulses. -->
        <div
          class="pointer-events-none absolute inset-x-0 top-0 h-1 bg-bg/85 {progress.total
            ? ''
            : 'animate-pulse'}"
        >
          <div
            class="h-full bg-fg transition-[width]"
            style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"
          ></div>
        </div>
      {/if}

      {#if selection === 'selected' || selection === 'unselected'}
        <div
          class="pointer-events-none absolute top-1.5 left-1.5 flex h-7 w-7 items-center justify-center border-2 backdrop-blur-md {selection ===
          'selected'
            ? 'border-fg bg-fg text-bg'
            : 'border-fg/60 bg-bg/85'}"
        >
          {#if selection === 'selected'}<Check size={16} strokeWidth={3} />{/if}
        </div>
      {:else if downloaded && !selection}
        <div
          class="pointer-events-none absolute top-1.5 left-1.5 flex h-7 w-7 items-center justify-center bg-bg/85 backdrop-blur-md"
          title="Downloaded"
        >
          <CloudCheck size={15} class="text-success" />
        </div>
      {/if}

      {#if action && !selection}
        <button
          class="hit absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center bg-bg/85 backdrop-blur-md {action.loading
            ? 'cursor-wait'
            : 'group cursor-pointer hover:bg-fg/20'}"
          onclick={(e) => {
            e.stopPropagation();
            action.onclick();
          }}
          disabled={action.loading}
          aria-label="{action.label} {displayName}"
        >
          <!-- Faded on the icon, not the button, so the backdrop matches the badge's. -->
          <action.icon
            size={16}
            class={action.loading ? 'animate-pulse opacity-40' : 'text-soft group-hover:text-fg'}
          />
        </button>
      {/if}
    {/snippet}
  </CoverThumbnail>
</div>
