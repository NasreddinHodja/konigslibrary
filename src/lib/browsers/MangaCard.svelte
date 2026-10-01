<script lang="ts">
  import { untrack, type ComponentType, type SvelteComponent } from 'svelte';
  import { FolderOpen, Cloud, CloudCheck, type IconProps } from 'lucide-svelte';
  import { knownMeta, queueMeta } from './cover-queue';
  import type { CardMeta } from '$lib/api/meta';
  import CoverThumbnail from '$lib/ui/CoverThumbnail.svelte';

  let {
    name,
    metaKey,
    loadMeta,
    ontitle,
    badge,
    action,
    onopen
  }: {
    name: string;
    /// Identifies this manga's metadata in the session cache.
    metaKey: string;
    loadMeta: () => Promise<CardMeta | null>;
    ontitle?: (title: string) => void;
    badge: 'device' | 'server' | 'downloaded';
    action?: {
      icon: ComponentType<SvelteComponent<IconProps>>;
      label: string;
      loading: boolean;
      onclick: () => void;
    } | null;
    onopen: () => void;
  } = $props();

  // Cards are keyed by manga, so the key never changes for a given card.
  const hit = knownMeta(untrack(() => metaKey));

  let el: HTMLDivElement | undefined = $state();
  let cover: string | null = $state(hit?.coverUrl ?? null);
  let title: string | null = $state(hit?.title ?? null);
  let coverFailed = $state(false);
  let loading = $state(hit === undefined);
  let requested = hit !== undefined;

  $effect(() => {
    if (hit?.title) untrack(() => ontitle?.(hit.title!));
  });

  const displayName = $derived(title || name);
  const src = $derived(coverFailed ? null : cover);

  $effect(() => {
    if (!el) return;
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

<div bind:this={el}>
  <CoverThumbnail
    {src}
    caption={displayName}
    alt="Open {displayName}"
    {loading}
    onclick={onopen}
    onImgError={() => (coverFailed = true)}
  >
    {#snippet overlay()}
      <div
        class="pointer-events-none absolute top-1.5 left-1.5 flex h-7 w-7 items-center justify-center bg-bg/75 backdrop-blur-sm"
        title={badge === 'device'
          ? 'Device folder'
          : badge === 'downloaded'
            ? 'Downloaded'
            : 'On server'}
      >
        {#if badge === 'device'}
          <FolderOpen size={15} class="opacity-70" />
        {:else if badge === 'downloaded'}
          <CloudCheck size={15} class="text-success" />
        {:else}
          <Cloud size={15} class="opacity-70" />
        {/if}
      </div>

      {#if action}
        <button
          class="hit absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center bg-bg/75 backdrop-blur-sm {action.loading
            ? 'animate-pulse cursor-wait opacity-40'
            : 'cursor-pointer opacity-80 hover:bg-fg/20 hover:opacity-100'}"
          onclick={(e) => {
            e.stopPropagation();
            action.onclick();
          }}
          disabled={action.loading}
          aria-label="{action.label} {displayName}"
        >
          <action.icon size={16} />
        </button>
      {/if}
    {/snippet}
  </CoverThumbnail>
</div>
