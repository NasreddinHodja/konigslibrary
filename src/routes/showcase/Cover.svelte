<script lang="ts">
  import Icon from './Icon.svelte';
  import { FOCUS, opts } from './options.svelte';

  let {
    src,
    title,
    badge = null,
    current = false,
    progress = null
  }: {
    src: string | undefined;
    title: string;
    badge?: 'downloaded' | 'download' | 'unselected' | 'selected' | null;
    current?: boolean;
    /// Download progress, 0 to 1.
    progress?: number | null;
  } = $props();

  // CP437 glyphs in the VGA font, so badges are the same pixels as the text.
  const BADGE = 'absolute top-1 flex size-6 items-center justify-center leading-none';

  // Current or selected: a solid ink frame and an inverted caption, so the
  // state stays in the ink's hue.
  const on = $derived(current || badge === 'selected');
</script>

<div class="min-w-0">
  <div
    class="relative aspect-[2/3] w-full overflow-hidden border-3 border-(--ink) {on
      ? 'border-solid'
      : 'border-double hover:border-(--hi)'}"
  >
    <button class="absolute inset-0 cursor-pointer {FOCUS}" aria-label="open {title}">
      {#if src}<img {src} alt="" class="absolute inset-0 size-full object-cover" />{/if}
    </button>

    {#if progress !== null}
      <div class="pointer-events-none absolute inset-x-0 top-0 h-1 bg-(--bg)">
        <div class="h-full bg-(--ink)" style:width="{progress * 100}%"></div>
      </div>
    {/if}

    {#if badge === 'selected'}
      <div class="{BADGE} left-1 bg-(--ink) text-(--bg)"><Icon name="check" scale={1} /></div>
    {:else if badge === 'unselected'}
      <div class="{BADGE} left-1 border border-(--ink) bg-(--bg)"></div>
    {:else if badge === 'downloaded'}
      <div class="{BADGE} left-1 bg-(--bg) text-(--ink)" title="downloaded">
        <Icon name="check" scale={1} />
      </div>
    {:else if badge === 'download'}
      <button
        class="{BADGE} right-1 cursor-pointer bg-(--bg) text-(--ink) hover:bg-(--ink) hover:text-(--bg) {FOCUS}"
        aria-label="download {title}"
      >
        <Icon name="download" scale={1} />
      </button>
    {/if}

    {#if opts.caption === 'band'}
      <p
        class="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 border-t border-(--ink) px-1 {on
          ? 'bg-(--ink) text-(--bg)'
          : 'bg-(--bg)'}"
      >
        {title}
      </p>
    {/if}
  </div>
  {#if opts.caption === 'under'}
    <p class="mt-1 line-clamp-2">{title}</p>
  {/if}
</div>
