<script lang="ts">
  import { ArrowLeft } from 'lucide-svelte';

  let {
    label,
    href,
    onclick
  }: {
    label: string;
    href?: string;
    onclick?: () => void;
  } = $props();

  const linkClass =
    'hit relative flex w-fit cursor-pointer items-center gap-1.5 text-xs tracking-widest text-dim hover:text-soft';
</script>

{#if href}
  <a {href} class={linkClass}>
    <ArrowLeft size={12} />
    {label}
  </a>
{:else}
  <button class={linkClass} {onclick}>
    <ArrowLeft size={12} />
    {label}
  </button>
{/if}
