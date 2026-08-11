<script lang="ts">
  import type { ComponentType, SvelteComponent } from 'svelte';
  import { FolderOpen, Cloud, CloudCheck, type IconProps } from 'lucide-svelte';
  import { fetchMangaMeta } from './cover-queue';
  import CoverThumbnail from '$lib/ui/CoverThumbnail.svelte';

  let {
    name,
    badge,
    action,
    onopen
  }: {
    name: string;
    badge: 'device' | 'server' | 'downloaded';
    action?: {
      icon: ComponentType<SvelteComponent<IconProps>>;
      label: string;
      loading: boolean;
      onclick: () => void;
    } | null;
    onopen: () => void;
  } = $props();

  let el: HTMLDivElement | undefined = $state();
  let cover: string | null = $state(null);
  let title: string | null = $state(null);
  let coverFailed = $state(false);
  let loading = $state(true);
  let requested = false;

  const displayName = $derived(title || name);
  const src = $derived(coverFailed ? null : cover);

  $effect(() => {
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || requested) return;
        requested = true;
        observer.disconnect();
        fetchMangaMeta(name).then((meta) => {
          cover = meta.coverUrl;
          title = meta.title;
          loading = false;
        });
      },
      { rootMargin: '200px' }
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
        class="pointer-events-none absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center bg-bg/75 backdrop-blur-sm"
        title={badge === 'device'
          ? 'Device folder'
          : badge === 'downloaded'
            ? 'Downloaded'
            : 'On server'}
      >
        {#if badge === 'device'}
          <FolderOpen size={11} class="opacity-70" />
        {:else if badge === 'downloaded'}
          <CloudCheck size={11} class="text-success" />
        {:else}
          <Cloud size={11} class="opacity-70" />
        {/if}
      </div>

      {#if action}
        <button
          class="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center bg-bg/75 backdrop-blur-sm {action.loading
            ? 'animate-pulse cursor-wait opacity-40'
            : 'cursor-pointer opacity-80 hover:bg-fg/20 hover:opacity-100'}"
          onclick={(e) => {
            e.stopPropagation();
            action.onclick();
          }}
          disabled={action.loading}
          aria-label="{action.label} {displayName}"
        >
          <action.icon size={12} />
        </button>
      {/if}
    {/snippet}
  </CoverThumbnail>
</div>
