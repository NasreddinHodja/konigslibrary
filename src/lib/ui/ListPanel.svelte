<script lang="ts">
  import Icon from './Icon.svelte';
  import { untrack, type Snippet } from 'svelte';
  import EmblaCarousel, { type EmblaCarouselType } from 'embla-carousel';
  import { inSystemGesture } from '$lib/utils/system-gestures';
  import { fade } from 'svelte/transition';
  import { ANIM_DURATION } from '$lib/utils/constants';

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
    actions,
    header,
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
    /// Buttons at the end of the label's row.
    actions?: Snippet;
    /// Above the label, inside the bar's panel: the page's own title row.
    header?: Snippet;
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

  /// Puts the tab fill at `progress` across the tabs, 0 being the first and 1
  /// the last: in step with the pages while they are dragged, the way
  /// Android's tab bar tracks its pager. The fill is the whole bar inverted,
  /// clipped to one tab's width, so the labels change colour where its edge
  /// crosses them. Set directly, not through state, so it costs nothing per
  /// frame.
  function moveIndicator(progress: number) {
    if (!indicator || tabs.length < 2) return;
    const p = Math.min(1, Math.max(0, progress));
    const left = (p * (tabs.length - 1) * 100) / tabs.length;
    indicator.style.clipPath = `inset(0 ${100 - left - 100 / tabs.length}% 0 ${left}%)`;
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
  /// In page flow: the bar is pinned below the status bar.
  let docked = $state(false);
  let bar: HTMLDivElement | undefined = $state();

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
      if (bar)
        docked = bar.getBoundingClientRect().top <= parseFloat(getComputedStyle(bar).top) + 0.5;
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

<!-- In page flow, back to top lands with the bar where it starts pinning.
     Pinned, the bar sits 12px below the status bar like the library's
     header, and that gap is filled with the background texture, lined up
     with the fixed one behind the page, so the list doesn't show through.
     4px wider on the right than the bar, to cover the list's raised shadow
     as it scrolls under. -->
<div
  bind:this={root}
  class="flex w-full min-w-0 flex-1 flex-col gap-3 {fill ? 'min-h-0' : ''}"
  style:scroll-margin-top={fill ? undefined : 'var(--safe-top)'}
>
  <div
    bind:this={bar}
    class="z-10 {fill ? 'shrink-0' : 'sticky -mt-3 -mr-1 pt-3 pr-1'}"
    style={fill ? undefined : 'top: var(--safe-top)'}
    style:background={docked ? 'var(--color-bg) var(--texture) fixed' : undefined}
    style:image-rendering={docked ? 'pixelated' : undefined}
  >
    <div class="flex flex-col gap-3 panel p-3">
      {@render header?.()}

      {#if label}
        <div class="flex items-center justify-between gap-3 border-b border-ink pb-1">
          <h2>{label}</h2>
          {@render actions?.()}
        </div>
      {/if}

      <!-- The box shows the focus: the field fills it. -->
      <label
        class="flex h-8 items-center gap-2 border border-ink px-2 focus-within:outline-1 focus-within:outline-offset-2 focus-within:outline-hi focus-within:outline-dotted pointer-coarse:h-10"
      >
        <span class="text-ink"><Icon name="search" /></span>
        <input
          type="text"
          {placeholder}
          aria-label={placeholder}
          bind:value={search}
          class="w-full min-w-0 bg-transparent placeholder:text-dim focus-visible:outline-none!"
        />
        {#if search}
          <button
            class="hit relative flex cursor-pointer items-center justify-center text-ink hover:text-hi"
            onclick={() => (search = '')}
            aria-label="Clear search"
          >
            <Icon name="close" size={12} />
          </button>
        {/if}
      </label>

      {#if tabs.length > 1}
        <div class="relative flex border border-ink" role="tablist">
          {#each tabs as t, i (t.key)}
            <button
              role="tab"
              aria-selected={activeTab === t.key}
              class="relative h-8 flex-1 cursor-pointer text-ink hover:text-hi pointer-coarse:h-10 {i >
              0
                ? 'border-l border-ink'
                : ''}"
              onclick={() => ontab?.(t.key)}
            >
              {@render tabLabel(t)}
            </button>
          {/each}
          <!-- The current tab's fill, following the pages as they're dragged:
               the labels again, inverted, over the tabs. -->
          <div
            bind:this={indicator}
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 flex bg-ink text-bg"
          >
            {#each tabs as t, i (t.key)}
              <div
                class="flex h-8 flex-1 items-center justify-center pointer-coarse:h-10 {i > 0
                  ? 'border-l border-ink'
                  : ''}"
              >
                {@render tabLabel(t)}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if fill}
    <!-- Embla's viewport, container and slides. -->
    <div class="min-h-0 flex-1 overflow-hidden panel" bind:this={viewport}>
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
            <div class="flex min-h-full flex-col p-3">
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
    <div class="flex flex-1 flex-col panel p-3">
      {@render children(activeTab ?? null)}
    </div>
    {@render toTop(farInFlow, () => root?.scrollIntoView({ behavior: 'smooth' }))}
  {/if}
</div>

{#snippet tabLabel(t: { label: string; badge?: Snippet })}
  <span class="inline-flex items-center gap-2">
    {t.label}
    {@render t.badge?.()}
  </span>
{/snippet}

{#snippet toTop(show: boolean, onclick: (e: MouseEvent) => void)}
  <!-- Takes no room. A `fill` page's list runs to the bottom of its scroll,
       so sticky holds there; in page flow the page goes on under the list,
       so it's fixed to the screen, lined up with the list's edge and clear
       of the mobile tab bar. -->
  <div
    class="pointer-events-none bottom-0 z-10 h-0 {fill ? 'sticky' : 'fixed'}"
    style:right={fill ? undefined : `${flowRight}px`}
  >
    {#if show}
      <button
        transition:fade={{ duration: ANIM_DURATION }}
        class="pointer-events-auto absolute right-4 flex size-12 cursor-pointer items-center justify-center panel text-ink hover:text-hi {fill
          ? 'bottom-4'
          : 'bottom-[calc(5.5rem_+_var(--safe-bottom))] md:bottom-4'}"
        aria-label="Back to top"
        title="Back to top"
        {onclick}
      >
        <Icon name="up" />
      </button>
    {/if}
  </div>
{/snippet}
