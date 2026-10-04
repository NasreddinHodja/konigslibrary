<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import EmblaCarousel, { type EmblaCarouselType } from 'embla-carousel';
  import { inSystemGesture } from '$lib/utils/system-gestures';
  import { fade } from 'svelte/transition';
  import { ArrowUp, Search, X } from 'lucide-svelte';

  // A searchable list: optional tabs and a label/search bar, then the list.
  //
  // Two layouts:
  //
  // - in page flow (default): the page owns the scrolling and the bar pins
  //   below the status bar once scrolled to the top (see AppShell).
  // - `fill`: the panel fills its parent, the bar stays put, and each tab is a
  //   page of its own with its own scroll, side by side in a carousel that
  //   follows the finger when swiped.
  let {
    tabs = [],
    activeTab,
    ontab,
    label,
    search = $bindable(''),
    placeholder,
    fill = false,
    pageClass = '',
    actions,
    children
  }: {
    /// `badge` is shown after the label, inside the tab.
    tabs?: { key: string; label: string; badge?: Snippet }[];
    activeTab?: string | null;
    ontab?: (key: string) => void;
    /// Omitted when the page's own title already names the list.
    label?: string;
    search?: string;
    placeholder: string;
    fill?: boolean;
    /// Added to each page's content in `fill` mode, for room under page chrome.
    pageClass?: string;
    /// Buttons at the end of the label's row.
    actions?: Snippet;
    /// The list for one tab; given null when there are no tabs.
    children: Snippet<[string | null]>;
  } = $props();

  const pages: (string | null)[] = $derived(tabs.length > 0 ? tabs.map((t) => t.key) : [null]);
  const index = $derived(Math.max(0, pages.indexOf(activeTab ?? null)));

  // The tab pages are an Embla carousel: Embla moves them with the finger,
  // flicks and settles them, and leaves a mostly vertical drag to the page's
  // own scroll. This only keeps it and the active tab in step both ways.
  /// How fast the pages settle (Embla's `duration`, default 25, higher is
  /// slower), after a tab tap and after a swipe alike.
  const DURATION = 5;
  /// Velocity kept each frame while settling (Embla's default is 0.68). With
  /// DURATION, picked by simulating Embla's integrator over a full page: 90%
  /// of the way in ~133ms, a ~2% overshoot, settled by ~283ms. Embla's own
  /// friction at this speed overshoots far more, and with two tabs every
  /// settle ends at an edge, where an overshoot bounces off it.
  const FRICTION = 0.55;

  let viewport: HTMLDivElement | undefined = $state();
  let indicator: HTMLDivElement | undefined = $state();
  let embla: EmblaCarouselType | undefined;

  /// Puts the tab underline at `progress` across the tabs, 0 being the first
  /// and 1 the last: in step with the pages while they are dragged, the way
  /// Android's tab bar tracks its pager. Set directly, not through state, so
  /// it costs nothing per frame.
  function moveIndicator(progress: number) {
    if (!indicator || tabs.length < 2) return;
    const p = Math.min(1, Math.max(0, progress));
    indicator.style.transform = `translateX(${p * (tabs.length - 1) * 100}%)`;
  }

  $effect(() => {
    const el = viewport;
    if (!el) return;
    const api = EmblaCarousel(el, {
      startIndex: untrack(() => index),
      duration: DURATION,
      // Only touch drags between tabs: with one page there's nowhere to go, a
      // mouse clicks the tabs instead, and a swipe in from the screen edge is
      // the system's back gesture.
      watchDrag: (_, evt) =>
        pages.length > 1 && 'touches' in evt && !inSystemGesture(evt.touches[0]?.clientX ?? 0)
    });
    // A swipe picked another page: that page's tab becomes the active one.
    api.on('select', () => {
      const key = pages[api.selectedScrollSnap()];
      if (key != null && key !== activeTab) ontab?.(key);
    });
    // Embla settles a swipe at its own fixed speed (25, less on a hard flick)
    // rather than `duration`, picked just before `pointerUp` fires. Swapped
    // for ours there, so a swipe settles like a tap; a hard flick may still
    // go faster. `internalEngine` is Embla's semi-internal API.
    api.on('pointerUp', () => {
      const body = api.internalEngine().scrollBody;
      body.useDuration(Math.min(body.duration(), DURATION)).useFriction(FRICTION);
    });
    const follow = () => moveIndicator(api.scrollProgress());
    api.on('scroll', follow);
    api.on('reInit', follow);
    follow();
    embla = api;
    return () => {
      api.destroy();
      embla = undefined;
    };
  });

  /// How far down, in screen heights, a list is scrolled before it offers a
  /// way back to its top.
  const FAR = 1;

  let root: HTMLDivElement | undefined = $state();
  /// `fill` pages scrolled past FAR, by tab key.
  let farPages: Record<string, boolean> = $state({});
  /// In page flow: the list's top is more than FAR above the screen.
  let farInFlow = $state(false);
  /// In page flow: the list's right edge, from the right of the screen.
  let flowRight = $state(0);

  function trackScroll(node: HTMLElement, key: string | null) {
    const onScroll = () => {
      farPages[String(key)] = node.scrollTop > node.clientHeight * FAR;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return { destroy: () => node.removeEventListener('scroll', onScroll) };
  }

  $effect(() => {
    const el = root;
    if (fill || !el) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      farInFlow = -rect.top > window.innerHeight * FAR;
      flowRight = window.innerWidth - rect.right;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });

  // A tab picked by a tap slides its page in. One picked by a swipe is
  // already where Embla is heading, so nothing changes.
  $effect(() => {
    const i = index;
    if (!embla || embla.selectedScrollSnap() === i) return;
    embla.scrollTo(i);
    // `scrollTo` restores Embla's own friction; ours lands without a bounce.
    embla.internalEngine().scrollBody.useFriction(FRICTION);
  });
</script>

<!-- In page flow, back to top lands with the bar where it starts pinning. -->
<div
  bind:this={root}
  class="flex w-full min-w-0 flex-1 flex-col {fill ? 'min-h-0' : ''}"
  style:scroll-margin-top={fill ? undefined : 'var(--safe-top)'}
>
  <div
    class="z-10 bg-bg {fill ? 'shrink-0' : 'sticky'}"
    style={fill ? undefined : 'top: var(--safe-top)'}
  >
    <div
      class="flex flex-col gap-3 border-b border-line px-4 pt-3 pb-4 sm:flex-row sm:items-center sm:gap-4"
    >
      {#if label}
        <div class="flex min-h-7 shrink-0 items-center justify-between gap-3">
          <span class="flex items-center gap-2">
            <span class="text-xs font-bold tracking-widest text-dim">{label}</span>
          </span>
          {@render actions?.()}
        </div>
      {/if}

      <div
        class="flex min-w-0 flex-1 items-center gap-2 border-2 border-line px-3 py-1.5 focus-within:border-fg/50 pointer-coarse:py-3"
      >
        <Search size={12} class="shrink-0 text-dim" />
        <input
          type="text"
          {placeholder}
          aria-label={placeholder}
          bind:value={search}
          class="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-dim"
        />
        {#if search}
          <button
            class="hit relative cursor-pointer text-dim hover:text-soft"
            onclick={() => (search = '')}
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        {/if}
      </div>
    </div>
    {#if tabs.length > 1}
      <div class="relative flex border-b border-line" role="tablist">
        {#each tabs as t (t.key)}
          <button
            role="tab"
            aria-selected={activeTab === t.key}
            class="flex-1 cursor-pointer px-4 pt-3.5 pb-2.5 text-xs font-bold tracking-widest transition-colors pointer-coarse:pt-4.5 pointer-coarse:pb-3.5 {activeTab ===
            t.key
              ? ''
              : 'text-faint hover:text-soft'}"
            onclick={() => ontab?.(t.key)}
          >
            <span class="inline-flex items-center gap-2">
              {t.label}
              {@render t.badge?.()}
            </span>
          </button>
        {/each}
        <div
          bind:this={indicator}
          class="pointer-events-none absolute -bottom-px left-0 h-0.5 bg-fg will-change-transform"
          style:width="{100 / tabs.length}%"
        ></div>
      </div>
    {/if}
  </div>

  {#if fill}
    <!-- Embla's viewport, container and slides. -->
    <div class="min-h-0 flex-1 overflow-hidden" bind:this={viewport}>
      <div class="flex h-full touch-pan-y">
        {#each pages as key (key)}
          <!-- Each page scrolls on its own, and is what the cards in it watch
               their visibility against. Vertical overscroll is contained: with
               the keyboard open, a scroll running past the end would otherwise
               carry on into panning the whole page, bar and all. -->
          <div
            data-scroll-root
            class="h-full min-w-0 shrink-0 grow-0 basis-full overflow-y-auto overscroll-y-contain"
            inert={key !== (activeTab ?? null)}
            use:trackScroll={key}
          >
            <div class="flex min-h-full flex-col p-4 {pageClass}">
              {@render children(key)}
            </div>
            {@render toTop(!!farPages[String(key)], (e) =>
              (e.currentTarget as HTMLElement)
                .closest('[data-scroll-root]')
                ?.scrollTo({ top: 0, behavior: 'smooth' })
            )}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="flex flex-1 flex-col p-4">
      {@render children(activeTab ?? null)}
    </div>
    {@render toTop(farInFlow, () => root?.scrollIntoView({ behavior: 'smooth' }))}
  {/if}
</div>

{#snippet toTop(show: boolean, onclick: (e: MouseEvent) => void)}
  <!-- Takes no room, and sits clear of the mobile tab bar. A `fill` page's
       list runs to the bottom of its scroll, so sticky holds there; in page
       flow the page goes on under the list, so it's fixed to the screen,
       lined up with the list's edge. -->
  <div
    class="pointer-events-none bottom-0 z-10 h-0 {fill ? 'sticky' : 'fixed'}"
    style:right={fill ? undefined : `${flowRight}px`}
  >
    {#if show}
      <button
        transition:fade={{ duration: 150 }}
        class="pointer-events-auto absolute right-4 bottom-[calc(4.75rem_+_var(--safe-bottom))] flex size-14 cursor-pointer items-center justify-center border-2 border-line bg-bg text-soft hover:text-fg md:bottom-4"
        aria-label="Back to top"
        title="Back to top"
        {onclick}
      >
        <ArrowUp size={24} />
      </button>
    {/if}
  </div>
{/snippet}
