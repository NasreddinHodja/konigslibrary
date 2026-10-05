<script lang="ts">
  import type { Snippet } from 'svelte';
  import { FOCUS, RAISED } from './options.svelte';

  // The proposed Button. Primary is filled with ink and raised; pressed, it
  // sinks into its shadow. Default is an ink outline that inverts on hover.
  // Text is a word, not an icon. `force` draws a state for the state table.
  let {
    kind = 'default',
    force = null,
    disabled = false,
    class: className = '',
    onclick = () => {},
    children
  }: {
    kind?: 'primary' | 'default' | 'text';
    force?: 'hover' | 'pressed' | 'focus' | null;
    disabled?: boolean;
    class?: string;
    onclick?: () => void;
    children: Snippet;
  } = $props();

  const SUNK = 'translate-x-0.5 translate-y-0.5 shadow-[2px_2px_0_var(--ink3)]';
  const SINKS =
    'enabled:active:translate-x-0.5 enabled:active:translate-y-0.5 enabled:active:shadow-[2px_2px_0_var(--ink3)]';

  const look = $derived.by(() => {
    const hover = force === 'hover';
    const pressed = force === 'pressed';
    if (kind === 'primary')
      return `border border-(--ink) px-3 text-(--bg) ${hover ? 'bg-(--hi)' : 'bg-(--ink) enabled:hover:bg-(--hi)'} ${pressed ? SUNK : `${RAISED} ${SINKS}`}`;
    if (kind === 'default')
      return `border border-(--ink) px-3 ${hover || pressed ? 'bg-(--ink) text-(--bg)' : 'text-(--ink) enabled:hover:bg-(--ink) enabled:hover:text-(--bg)'}`;
    return hover
      ? 'text-(--hi) underline'
      : 'text-(--ink) enabled:hover:text-(--hi) enabled:hover:underline';
  });
</script>

<button
  class="hit relative inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 disabled:cursor-default disabled:opacity-40 pointer-coarse:h-10
    {look} {FOCUS} {force === 'focus'
    ? 'outline-1 outline-offset-2 outline-(--hi) outline-dotted'
    : ''} {className}"
  {disabled}
  {onclick}
>
  {@render children()}
</button>
