<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    size = 'md',
    as = 'button',
    onclick,
    children
  }: {
    size?: 'lg' | 'md' | 'icon';
    as?: 'button' | 'span';
    onclick?: () => void;
    children: Snippet;
  } = $props();

  const classes: Record<string, string> = {
    lg: 'border-2 px-6 py-3 hover:bg-white/20',
    md: 'border-2 px-3 py-2 hover:bg-white/20',
    icon: 'p-2 hover:bg-white/20'
  };
</script>

{#if as === 'span'}
  <span
    class={classes[size]}
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
  <button class={classes[size]} {onclick}>
    {@render children()}
  </button>
{/if}
