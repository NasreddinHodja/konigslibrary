<script lang="ts">
  import type { Snippet } from 'svelte';

  // Primary is the one thing a screen is for: filled with ink and raised, and
  // pressed it sinks into its shadow. Default is an ink outline that inverts
  // on hover. Text is a bare word, only as tall as its line: `hit` gives it
  // the touch target.
  let {
    variant = 'default',
    disabled = false,
    class: className = '',
    onclick,
    children
  }: {
    variant?: 'default' | 'primary' | 'text';
    disabled?: boolean;
    class?: string;
    onclick?: () => void;
    children: Snippet;
  } = $props();

  const variantClass = $derived(
    {
      primary:
        'h-8 border border-ink bg-ink px-3 pointer-coarse:h-10 text-bg shadow-raised enabled:hover:bg-hi enabled:active:translate-x-0.5 enabled:active:translate-y-0.5 enabled:active:shadow-sunk',
      default:
        'h-8 border border-ink px-3 pointer-coarse:h-10 text-ink enabled:hover:bg-ink enabled:hover:text-bg',
      text: 'text-ink enabled:hover:text-hi enabled:hover:underline'
    }[variant]
  );
</script>

<button
  class="hit relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 disabled:cursor-default disabled:opacity-40 {variantClass} {className}"
  {onclick}
  {disabled}
>
  {@render children()}
</button>
