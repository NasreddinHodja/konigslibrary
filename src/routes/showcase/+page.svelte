<script lang="ts">
  import { onMount } from 'svelte';
  import { reducedMotion } from '$lib/utils/constants';
  import Btn from './Btn.svelte';
  import Cover from './Cover.svelte';
  import Phone from './Phone.svelte';
  import Switch from './Switch.svelte';
  import Icon from './Icon.svelte';
  import { ICON_SETS } from './icons';
  import { contrast } from './contrast';
  import { TITLES, coverUrl, ditheredCoverUrl, pageUrl, textureUrl } from './fakes';
  import { FOCUS, PALETTES, RAISED, opts, tokens, type Palette } from './options.svelte';

  // The redesign tried out before the app changes: a bitmap font, two-tone
  // palettes with an ink, raised panels and dither. Everything is scoped to
  // this page through CSS variables; the app's own theme isn't touched.

  let paletteId = $state('vapor');
  /// Picked with the colour inputs; starts as meth pink.
  let custom: Palette = $state({ ...PALETTES[0], id: 'custom', name: 'custom' });
  const palette = $derived(
    paletteId === 'custom' ? custom : (PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0])
  );

  const t = $derived(tokens(palette));

  let covers: string[] = $state([]);
  let pages: string[] = $state([]);
  onMount(() => {
    covers = TITLES.map((_, i) => coverUrl(i));
    pages = [0, 1, 2, 3].map(pageUrl);
  });

  // Redrawn in the palette's colours whenever it changes.
  const texture = $derived(textureUrl(t.bg, t.ink2));
  const mangaBackdrop = $derived(ditheredCoverUrl(0, t.bg, t.ink3));

  let tab = $state('server');
  let rtl = $state('rtl');
  let mode = $state('turn');

  /// A text spinner, CP437-style; still under reduced motion.
  const SPIN = ['|', '/', '-', '\\'];
  let spin = $state(0);
  onMount(() => {
    if (reducedMotion) return;
    const id = setInterval(() => (spin = (spin + 1) % SPIN.length), 150);
    return () => clearInterval(id);
  });

  const bar = (done: number, total: number, width = 16) => {
    const n = Math.round((done / total) * width);
    return '█'.repeat(n) + '░'.repeat(width - n);
  };

  const TOKEN_ROWS = [
    { name: 'fg', job: 'text', need: 4.5 },
    { name: 'dim', job: 'text', need: 4.5 },
    { name: 'ink', job: 'text, edges', need: 4.5 },
    { name: 'hi', job: 'hover', need: 4.5 },
    { name: 'ink2', job: 'shadow', need: 0 },
    { name: 'ink3', job: 'shadow', need: 0 }
  ] as const;

  const PANEL = `border border-(--ink) bg-(--bg) ${RAISED}`;
  const FIELD = `h-8 w-full border border-(--ink) bg-(--bg) px-2 text-(--fg) placeholder:text-(--dim) pointer-coarse:h-10 ${FOCUS}`;
  const LINK = `text-(--ink) hover:text-(--hi) hover:underline ${FOCUS}`;
  const TITLE = 'border-b border-(--ink) text-(length:--title) leading-[1.25]';
  const TAGS = ['action', 'dark fantasy', 'seinen', 'tragedy'];
  /// A 50% checkerboard of the background, for behind a dialog.
  const BACKDROP =
    'conic-gradient(var(--bg) 25%, transparent 0 50%, var(--bg) 0 75%, transparent 0)';
</script>

<svelte:head>
  <title>Showcase · konigslibrary</title>
</svelte:head>

{#snippet section(name: string)}
  <h2 class="{TITLE} mb-6">{name}</h2>
{/snippet}

{#snippet fact(key: string, value: string)}
  <div class="flex items-baseline gap-2">
    <span class="text-(--dim)">{key}</span>
    <span class="flex-1 border-b border-dotted border-(--ink3)"></span>
    <span class="text-right">{value}</span>
  </div>
{/snippet}

{#snippet facts()}
  <div class="flex flex-col gap-1">
    {@render fact('status', 'ongoing')}
    {@render fact('author', 'Kentaro Miura')}
    {@render fact('year', '1989')}
    <p><span class="text-(--dim)">tags</span> {TAGS.join(', ')}</p>
  </div>
{/snippet}

{#snippet chapterTile(n: number, resume: boolean, thumb: string | undefined)}
  <button
    class="relative flex aspect-[2/3] cursor-pointer flex-col justify-end overflow-hidden text-left {FOCUS} {resume
      ? 'border-3 border-(--ink)'
      : 'border border-(--ink) hover:border-(--hi)'}"
    aria-label="chapter {n}"
  >
    {#if thumb}<img
        src={thumb}
        alt=""
        class="absolute inset-0 size-full object-cover object-top"
      />{/if}
    <span
      class="relative flex justify-between border-t border-(--ink) px-1 {resume
        ? 'bg-(--ink) text-(--bg)'
        : 'bg-(--bg)'}"
    >
      <span>{n}</span><span class={resume ? '' : 'text-(--dim)'}>24p</span>
    </span>
  </button>
{/snippet}

{#snippet coverGrid(count: number)}
  <div class="grid grid-cols-3 gap-x-3 {opts.caption === 'under' ? 'gap-y-4' : 'gap-y-3'}">
    {#each { length: count }, i (i)}
      <Cover
        src={covers[i % covers.length]}
        title={TITLES[i % TITLES.length]}
        badge={i === 0 || i === 4 ? 'downloaded' : i === 2 || i === 6 ? 'download' : null}
        progress={i === 3 ? 0.4 : null}
      />
    {/each}
  </div>
{/snippet}

{#snippet tabBar(current: 'library' | 'settings')}
  <nav class="absolute inset-x-0 bottom-0 flex gap-2 border-t border-(--ink) bg-(--bg) p-2">
    {#each ['library', 'upload', 'settings'] as item (item)}
      <a
        href="#top"
        class="flex flex-1 flex-col items-center justify-center gap-1 border border-(--ink) py-1 {FOCUS} {current ===
        item
          ? 'bg-(--ink) text-(--bg)'
          : 'text-(--ink) hover:bg-(--ink3) hover:text-(--hi)'}"
      >
        <Icon name={item} />
        {item}
      </a>
    {/each}
  </nav>
{/snippet}

{#snippet toast()}
  <div class="flex flex-col gap-1 px-3 py-2 {PANEL}">
    <div class="flex justify-between gap-3">
      <span>{SPIN[spin]} downloading berserk flame</span>
      <Btn kind="text"><Icon name="close" /></Btn>
    </div>
    <div class="flex items-center justify-between gap-3">
      <span class="text-(--ink)">{bar(5, 12)}</span>
      <span class="text-(--dim)">5/12</span>
    </div>
    <div><Btn kind="text">cancel</Btn></div>
  </div>
{/snippet}

{#snippet libraryScreen()}
  <div class="absolute inset-0 flex flex-col gap-4 overflow-y-auto p-3 pb-24">
    <div class="flex flex-col gap-3 p-3 {PANEL}">
      <div class="flex items-end justify-between gap-2 border-b border-(--ink)">
        <h1 class="text-(length:--title) leading-[1.25]">library</h1>
        <span class="flex gap-3 pb-1">
          <Btn kind="text"><Icon name="select" /></Btn>
          <Btn kind="text"><Icon name="refresh" /></Btn>
        </span>
      </div>
      <label class="flex items-center gap-2 border border-(--ink) px-2 text-(--ink)"
        ><Icon name="search" /><input
          class="h-8 w-full min-w-0 bg-transparent text-(--fg) placeholder:text-(--dim) focus-visible:outline-none! pointer-coarse:h-10"
          placeholder="search library"
          aria-label="search library"
        /></label
      >
      <Switch
        label="source"
        options={[
          { key: 'device', label: 'device' },
          { key: 'server', label: 'server' }
        ]}
        value={tab}
        onpick={(k) => (tab = k)}
      />
      <p class="text-(--dim)">server: <span class="text-(--ink)">online</span></p>
    </div>
    <div class="p-3 {PANEL}">{@render coverGrid(9)}</div>
  </div>
  {@render tabBar('library')}
{/snippet}

<div
  id="top"
  class="relative min-h-dvh pb-16 text-(length:--body) leading-normal text-(--fg)"
  style:--bg={t.bg}
  style:--fg={t.fg}
  style:--dim={t.dim}
  style:--ink={t.ink}
  style:--hi={t.hi}
  style:--ink2={t.ink2}
  style:--ink3={t.ink3}
  style:background-color={t.bg}
  style:--body="16px"
  style:--title="32px"
  style:font-family="'VGA', monospace"
  style:-webkit-font-smoothing="none"
>
  {#if texture}
    <div
      class="fixed inset-0"
      style:background-image="url({texture})"
      style:image-rendering="pixelated"
    ></div>
  {/if}

  <!-- Switches -->
  <div class="sticky top-0 z-30 border-b border-(--ink) bg-(--bg)">
    <div class="flex flex-wrap items-end gap-6 px-8 py-3">
      <h1 class="mr-auto text-(length:--title) leading-[1.25]">showcase</h1>
      <div class="flex flex-col gap-1">
        <span class="text-(--dim)">icons</span>
        <Switch
          label="icon font"
          options={Object.keys(ICON_SETS).map((k) => ({ key: k, label: k }))}
          value={opts.iconSet}
          onpick={(k) => (opts.iconSet = k as typeof opts.iconSet)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-(--dim)">icon size</span>
        <Switch
          label="icon size"
          options={[
            { key: '1', label: '1x' },
            { key: '2', label: '2x' }
          ]}
          value={String(opts.iconScale)}
          onpick={(k) => (opts.iconScale = Number(k) as 1 | 2)}
        />
      </div>
    </div>
  </div>

  <div class="relative mx-auto flex max-w-6xl flex-col gap-12 px-8 pt-12">
    <!-- Palette -->
    <section class="flex flex-col gap-6 p-6 {PANEL}">
      {@render section('palette')}
      <div class="grid grid-cols-4 gap-3">
        {#each [...PALETTES, custom] as p (p.id)}
          <button
            class="flex cursor-pointer items-center gap-2 border p-2 text-left {FOCUS} {paletteId ===
            p.id
              ? 'border-(--ink) bg-(--ink) text-(--bg)'
              : 'border-(--ink) hover:bg-(--ink3) hover:text-(--hi)'}"
            onclick={() => (paletteId = p.id)}
          >
            <span class="flex border border-(--ink3)">
              <span class="size-6" style:background={p.bg}></span>
              <span class="size-6" style:background={p.fg}></span>
              <span class="size-6" style:background={p.ink}></span>
            </span>
            {p.name}
          </button>
        {/each}
      </div>
      <div class="flex flex-wrap items-center gap-6">
        <span class="text-(--dim)">custom:</span>
        {#each [['bg', 'background'], ['fg', 'text'], ['ink', 'ink']] as const as [key, label] (key)}
          <label class="flex items-center gap-2">
            {label}
            <input
              type="color"
              class="h-8 w-12 cursor-pointer border border-(--ink) bg-(--bg) {FOCUS}"
              value={custom[key]}
              oninput={(e) => {
                custom[key] = e.currentTarget.value;
                paletteId = 'custom';
              }}
            />
            <span class="text-(--dim)">{custom[key]}</span>
          </label>
        {/each}
      </div>
    </section>

    <div class="grid grid-cols-2 gap-8">
      <!-- Type -->
      <section class="p-6 {PANEL}">
        {@render section('type')}
        <div class="flex flex-col gap-4">
          <p class="text-(length:--title) leading-[1.25]">title, 32px</p>
          <p>
            Everything else is 16px, the font's own height: body, labels, buttons. Someone has been
            guessing the password, so a new device has to be let in by one that's already logged in.
          </p>
          <p class="text-(--dim)">dim: at least 8 characters.</p>
          <p><a href="#top" class={LINK}>a link</a></p>
          <p class="text-(--ink)">← → ↑ ↓ ► ◄ √ ■ « » · ≡ ░▒▓█ ┌─┐└─┘</p>
          <p>Æther Blade, Ōkami, Ça va <span class="text-(--dim)">(extended Latin)</span></p>
          <p>ベルセルク <span class="text-(--dim)">(Japanese falls back)</span></p>
        </div>
      </section>

      <!-- Colour -->
      <section class="p-6 {PANEL}">
        {@render section(`colour: ${palette.name}`)}
        <table class="w-full">
          <tbody>
            {#each TOKEN_ROWS as row (row.name)}
              {@const ratio = contrast(t[row.name], t.bg)}
              <tr class="border-b border-(--ink3)">
                <td class="py-1 pr-3">
                  <span class="inline-block size-4 align-middle" style:background={t[row.name]}
                  ></span>
                  {row.name}
                </td>
                <td class="py-1 pr-3 text-(--dim)">{row.job}</td>
                <td class="py-1 pr-3">{ratio.toFixed(2)}</td>
                <td class="py-1">
                  {#if row.need === 0}<span class="text-(--dim)">n/a</span>
                  {:else if ratio >= row.need}<span class="text-(--ink)">ok ≥{row.need}</span>
                  {:else}<span class="underline">fails {row.need}</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    </div>

    <!-- Icons -->
    <section class="p-6 {PANEL}">
      {@render section('icons')}
      <table class="w-full">
        <thead>
          <tr class="border-b border-(--ink)">
            <th class="py-1 text-left font-normal text-(--dim)">slot</th>
            {#each Object.entries(ICON_SETS) as [name, set] (name)}
              <th class="py-1 text-left font-normal text-(--dim)">
                {name} <span class="block">{set.credit}</span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each Object.keys(ICON_SETS.cozette.icons) as slot (slot)}
            <tr class="border-b border-(--ink3)">
              <td class="py-2 pr-4">{slot}</td>
              {#each Object.keys(ICON_SETS) as name (name)}
                <td class="py-2 pr-4 text-(--ink)">
                  <span class="flex items-end gap-3">
                    <Icon name={slot} set={name} scale={1} />
                    <Icon name={slot} set={name} scale={2} />
                    <span class="flex items-center gap-2 border border-(--ink) px-2"
                      ><Icon name={slot} set={name} scale={1} />{slot}</span
                    >
                  </span>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <!-- Buttons -->
    <section class="p-6 {PANEL}">
      {@render section('buttons')}
      <div class="grid grid-cols-[6rem_repeat(5,auto)] items-center justify-start gap-x-8 gap-y-6">
        <span></span>
        {#each ['rest', 'hover', 'pressed', 'focus', 'disabled'] as h (h)}
          <span class="text-(--dim)">{h}</span>
        {/each}
        {#each ['primary', 'default', 'text'] as const as kind (kind)}
          <span class="text-(--dim)">{kind}</span>
          <Btn {kind}>resume</Btn>
          <Btn {kind} force="hover">resume</Btn>
          <Btn {kind} force="pressed">resume</Btn>
          <Btn {kind} force="focus">resume</Btn>
          <Btn {kind} disabled>resume</Btn>
        {/each}
      </div>
      <div class="mt-8 flex flex-wrap items-center gap-4">
        <span class="text-(--dim)">try them:</span>
        <Btn kind="primary">resume ch. 12 p. 4</Btn>
        <Btn>download</Btn>
        <Btn kind="primary">allow 4821</Btn>
        <Btn>deny</Btn>
        <Btn><Icon name="folder" /> browse…</Btn>
        <Btn kind="text"><Icon name="down" /> newest</Btn>
        <Btn disabled>connecting…</Btn>
      </div>
    </section>

    <div class="grid grid-cols-2 gap-8">
      <!-- Fields -->
      <section class="p-6 {PANEL}">
        {@render section('fields')}
        <div class="flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-(--dim)">username</span>
            <input class={FIELD} placeholder="rest" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-(--dim)">focused</span>
            <input
              class="{FIELD} outline-1 outline-offset-2 outline-(--hi) outline-dotted"
              value="nas"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-(--dim)">server url</span>
            <input class="{FIELD} border-dashed" value="192.168.1.9:3000" aria-invalid="true" />
            <span class="text-(--ink)">► can't reach 192.168.1.9:3000</span>
          </label>
        </div>
      </section>

      <!-- Navigation -->
      <section class="p-6 {PANEL}">
        {@render section('navigation')}
        <div class="flex flex-col gap-4">
          <Switch
            label="direction"
            options={[
              { key: 'ltr', label: 'ltr' },
              { key: 'rtl', label: 'rtl' }
            ]}
            value={rtl}
            onpick={(k) => (rtl = k)}
          />
          <Switch
            label="mode"
            options={[
              { key: 'turn', label: 'turn' },
              { key: 'scroll', label: 'scroll' }
            ]}
            value={mode}
            onpick={(k) => (mode = k)}
          />
          <nav class="flex flex-col">
            {#each ['library', 'server', 'theme', 'shortcuts'] as s, i (s)}
              <a
                href="#top"
                class="border border-(--ink) px-2 py-1 {FOCUS} {i > 0 ? '-mt-px' : ''} {i === 1
                  ? 'bg-(--ink) text-(--bg)'
                  : 'text-(--ink) hover:bg-(--ink3) hover:text-(--hi)'}"
              >
                {i === 1 ? '►' : '›'}
                {s}
              </a>
            {/each}
          </nav>
          <p>
            <a href="#top" class={LINK}>← back</a> ·
            <a href="#top" class={LINK}>how to use</a>
          </p>
        </div>
      </section>
    </div>

    <div class="grid grid-cols-2 gap-8">
      <!-- Facts -->
      <section class="p-6 {PANEL}">
        {@render section('facts and progress')}
        <div class="flex flex-col gap-6">
          {@render facts()}
          <p><span class="text-(--ink)">{bar(5, 12)}</span> 5/12 chapters</p>
          <p>{SPIN[spin]} checking the server…</p>
        </div>
      </section>

      <!-- Layers -->
      <section class="flex flex-col gap-6 p-6 {PANEL}">
        {@render section('layers')}
        {@render toast()}
        <div class="p-4 {PANEL}" role="group" aria-label="dialog">
          <p class="mb-4">
            Delete "Berserk Flame"? This removes all its chapters from this device.
          </p>
          <div class="flex justify-end gap-3">
            <Btn>cancel</Btn>
            <Btn kind="primary">delete</Btn>
          </div>
        </div>
      </section>
    </div>

    <!-- Cards -->
    <section class="p-6 {PANEL}">
      {@render section('cards')}
      <div class="grid grid-cols-7 gap-3">
        {#each [{ label: 'plain', badge: null }, { label: 'downloaded', badge: 'downloaded' }, { label: 'download', badge: 'download' }, { label: 'downloading', badge: null, progress: 0.4 }, { label: 'unselected', badge: 'unselected' }, { label: 'selected', badge: 'selected' }, { label: 'current', badge: null, current: true }] as const as c, i (c.label)}
          <div class="flex flex-col gap-1">
            <span class="text-(--dim)">{c.label}</span>
            <Cover
              src={covers[i]}
              title={TITLES[i]}
              badge={c.badge}
              progress={'progress' in c ? c.progress : null}
              current={'current' in c}
            />
          </div>
        {/each}
      </div>
      <div class="mt-6 grid max-w-md grid-cols-4 gap-2">
        {@render chapterTile(11, false, pages[0])}
        {@render chapterTile(12, true, pages[1])}
        {@render chapterTile(13, false, undefined)}
        {@render chapterTile(14, false, pages[2])}
      </div>
      <div class="mt-6 flex items-end gap-6">
        <img
          src={mangaBackdrop}
          alt="The first cover, dithered"
          class="w-[300px]"
          style:image-rendering="pixelated"
        />
        <p class="max-w-xs text-(--dim)">
          a cover dithered into the palette: for behind the manga page, never instead of the cover
        </p>
      </div>
    </section>

    <!-- Screens -->
    <section class="flex flex-col gap-6">
      <h2 class="{TITLE} bg-(--bg) px-2">screens</h2>
      <div class="flex flex-wrap gap-8">
        <Phone title="library" {texture}>
          {@render libraryScreen()}
        </Phone>

        <Phone title="manga" {texture}>
          <img
            src={mangaBackdrop}
            alt=""
            class="absolute inset-x-0 top-0 h-80 w-full object-cover"
            style:image-rendering="pixelated"
          />
          <div class="absolute inset-0 flex flex-col gap-4 overflow-y-auto p-3 pt-40 pb-24">
            <div class="flex flex-col gap-3 p-3 {PANEL}">
              <a href="#top" class="flex w-fit items-center gap-2 {LINK}"
                ><Icon name="back" /> library</a
              >
              <h1 class={TITLE}>Berserk Flame</h1>
              <div class="flex gap-3">
                <div class="w-28 shrink-0 border-3 border-double border-(--ink)">
                  {#if covers[0]}<img
                      src={covers[0]}
                      alt=""
                      class="aspect-[2/3] w-full object-cover"
                    />{/if}
                </div>
                <div class="min-w-0 flex-1">{@render facts()}</div>
              </div>
              <div class="flex flex-col gap-3 pt-1">
                <Btn kind="primary" class="w-full">resume ch. 12 p. 4</Btn>
                <Btn class="w-full">download</Btn>
              </div>
            </div>
            <div class="flex flex-col gap-3 p-3 {PANEL}">
              <div class="flex items-end justify-between border-b border-(--ink)">
                <h2>chapters (24)</h2>
                <Btn kind="text"><Icon name="down" /> newest</Btn>
              </div>
              <label class="flex items-center gap-2 border border-(--ink) px-2 text-(--ink)"
                ><Icon name="search" /><input
                  class="h-8 w-full min-w-0 bg-transparent text-(--fg) placeholder:text-(--dim) focus-visible:outline-none! pointer-coarse:h-10"
                  placeholder="search chapters"
                  aria-label="search chapters"
                /></label
              >
              <div class="grid grid-cols-4 gap-2">
                {#each { length: 8 }, i (i)}
                  {@render chapterTile(24 - i, i === 3, pages[i % 4])}
                {/each}
              </div>
            </div>
          </div>
          {@render tabBar('library')}
        </Phone>

        <Phone title="reader">
          <div class="absolute inset-0 flex items-center justify-center bg-black">
            {#if pages[0]}<img src={pages[0]} alt="" class="max-h-full max-w-full" />{/if}
          </div>
          <div class="absolute inset-x-0 top-0 flex items-center gap-3 bg-(--bg) px-3 pt-2 pb-2.5">
            <Btn kind="text"><Icon name="back" /></Btn>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">Berserk Flame</span>
              <span class="truncate text-(--dim)">chapter 12</span>
            </div>
            <Btn>4/24</Btn>
            <!-- The bar's bottom edge is the chapter's progress. -->
            <div class="absolute inset-x-0 bottom-0 h-0.5 bg-(--ink3)">
              <div class="h-full w-1/6 bg-(--ink)"></div>
            </div>
          </div>
          <div class="absolute inset-x-4 bottom-6 flex flex-col gap-3 p-3 {PANEL}">
            <Switch
              label="direction"
              options={[
                { key: 'ltr', label: 'ltr' },
                { key: 'rtl', label: 'rtl' }
              ]}
              value={rtl}
              onpick={(k) => (rtl = k)}
            />
            <Switch
              label="mode"
              options={[
                { key: 'turn', label: 'turn' },
                { key: 'scroll', label: 'scroll' }
              ]}
              value={mode}
              onpick={(k) => (mode = k)}
            />
            <a href="#top" class="flex items-center gap-2 self-center {LINK}"
              ><Icon name="settings" /> settings</a
            >
          </div>
        </Phone>

        <Phone title="settings" {texture}>
          <div class="absolute inset-0 overflow-y-auto pb-20">
            <div class="flex flex-col gap-4 p-3">
              <div class="flex flex-col gap-3 p-3 {PANEL}">
                <a href="#top" class="flex w-fit items-center gap-2 {LINK}"
                  ><Icon name="back" /> back</a
                >
                <h1 class={TITLE}>settings</h1>
                <p class="flex flex-wrap gap-x-4">
                  {#each ['library', 'server', 'theme', 'diagnostics'] as s (s)}
                    <a href="#top" class={LINK}>› {s}</a>
                  {/each}
                </p>
              </div>

              <section class="flex flex-col gap-3 p-3 {PANEL}">
                <h2 class="underline">library</h2>
                <label class="flex flex-col gap-1">
                  <span class="text-(--dim)">manga directory</span>
                  <input class={FIELD} value="/home/nas/Manga" />
                </label>
                <div class="flex gap-3">
                  <Btn><Icon name="folder" /> browse…</Btn><Btn>save</Btn>
                </div>
              </section>

              <section class="flex flex-col gap-3 p-3 {PANEL}">
                <h2 class="underline">server</h2>
                <label class="flex flex-col gap-1">
                  <span class="text-(--dim)">server url</span>
                  <input class={FIELD} value="192.168.1.9:3000" />
                </label>
                <div class="flex items-center gap-3">
                  <Btn>connect</Btn><span class="text-(--dim)">server found</span>
                </div>
                <div class="flex items-center justify-between gap-3 border-t border-(--ink3) pt-3">
                  <span>logged in as <span class="text-(--ink)">nas</span></span>
                  <Btn>log out</Btn>
                </div>
                <div class="flex flex-col gap-2 border-t border-(--ink3) pt-3">
                  <span class="text-(--dim)">waiting to log in</span>
                  <p>Pixel 8 <span class="text-(--dim)">from 192.168.1.23</span></p>
                  <div class="flex gap-3"><Btn kind="primary">allow 4821</Btn><Btn>deny</Btn></div>
                </div>
              </section>

              <section class="flex flex-col gap-3 p-3 {PANEL}">
                <h2 class="underline">theme</h2>
                <p class="flex flex-wrap gap-x-4">
                  {#each PALETTES as p (p.id)}
                    <button
                      class="cursor-pointer px-1 {FOCUS} {paletteId === p.id
                        ? 'bg-(--ink) text-(--bg)'
                        : 'text-(--ink) hover:text-(--hi) hover:underline'}"
                      onclick={() => (paletteId = p.id)}
                    >
                      {paletteId === p.id ? '►' : '›'}
                      {p.name}
                    </button>
                  {/each}
                </p>
              </section>
            </div>

            <footer class="flex flex-col items-center gap-2 py-10">
              <pre
                class="bg-(--bg) text-(length:--title) leading-none text-(--ink)"
                aria-label="konigslibrary">╔═════════════╗
║KONIGSLIBRARY║
╚═════════════╝</pre>
              <p class="bg-(--bg) px-1 text-(--dim)">by nas</p>
            </footer>
          </div>
          {@render tabBar('settings')}
        </Phone>

        <Phone title="login" {texture}>
          <div class="absolute inset-0 flex flex-col gap-4 overflow-y-auto p-3 pt-16">
            <div class="flex flex-col gap-4 p-3 {PANEL}">
              <h1 class={TITLE}>log in</h1>
              <p class="text-(--dim)">http://192.168.1.9:3000</p>
              <form class="flex flex-col gap-3" onsubmit={(e) => e.preventDefault()}>
                <label class="flex flex-col gap-1">
                  <span class="text-(--dim)">username</span>
                  <input class={FIELD} autocomplete="off" />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-(--dim)">password</span>
                  <input class={FIELD} type="password" autocomplete="off" />
                </label>
                <div class="flex items-center gap-4 pt-1">
                  <Btn kind="primary">log in</Btn>
                  <a href="#top" class={LINK}>change server</a>
                </div>
                <p class="text-(--ink)">► wrong username or password</p>
              </form>
            </div>
            <div class="flex flex-col gap-3 p-3 {PANEL}">
              <h2 class="underline">waiting for approval</h2>
              <p class="text-center text-(length:--title) leading-[1.25] text-(--ink)">4821</p>
              <p class="text-(--dim)">
                {SPIN[spin]} waiting… if no login shows up there, the password was wrong.
              </p>
              <div><Btn>cancel</Btn></div>
            </div>
          </div>
        </Phone>

        <Phone title="dialog and toast" {texture}>
          {@render libraryScreen()}
          <div
            class="absolute inset-0"
            style:background-image={BACKDROP}
            style:background-size="2px 2px"
          ></div>
          <div class="absolute inset-x-4 top-1/3 p-4 {PANEL}">
            <p class="mb-4">Download "Berserk Flame"? This may take a while depending on size.</p>
            <div class="flex justify-end gap-3">
              <Btn>cancel</Btn>
              <Btn kind="primary">download</Btn>
            </div>
          </div>
          <div class="absolute inset-x-4 bottom-24">{@render toast()}</div>
        </Phone>
      </div>
    </section>
  </div>
</div>

<style>
  @font-face {
    font-family: 'VGA';
    src: url('/fonts/WebPlus_IBM_VGA_9x16.woff') format('woff');
    font-display: block;
  }
</style>
