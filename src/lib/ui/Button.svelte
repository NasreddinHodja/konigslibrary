<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    size = 'md',
    as = 'button',
    variant = 'default',
    disabled = false,
    class: className = '',
    onclick,
    children
  }: {
    size?: 'lg' | 'md' | 'sm' | 'icon';
    as?: 'button' | 'span';
    variant?: 'default' | 'primary' | 'ghost';
    disabled?: boolean;
    class?: string;
    onclick?: () => void;
    children: Snippet;
  } = $props();

  const variantClass = $derived(
    {
      default: 'border-2 hover:bg-fg/10',
      primary: 'bg-fg text-bg hover:bg-fg/90',
      ghost: 'hover:bg-fg/10'
    }[variant]
  );

  const sizeClass = $derived(
    {
      lg: 'px-6 py-3 text-sm font-bold tracking-wide',
      md: 'px-3 py-2 text-sm',
      sm: 'px-2 py-1 text-xs',
      icon: 'p-2'
    }[size]
  );
</script>

{#if as === 'span'}
  <span
    class="inline-flex cursor-pointer items-center gap-2 {variantClass} {sizeClass} {className}"
    tabindex="0"
    role="button"
    onkeydown={(e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        (e.currentTarget as HTMLElement).closest('label')?.click();
      }
    }}
  >
    {@render children()}
  </span>
{:else}
  <button
    class="inline-flex items-center gap-2 {variantClass} {sizeClass} {className} {disabled
      ? 'cursor-not-allowed opacity-60'
      : 'cursor-pointer'}"
    {onclick}
    {disabled}
  >
    {@render children()}
  </button>
{/if}
