<script lang="ts">
  import { ArrowLeft } from 'lucide-svelte';

  let {
    label,
    href,
    onclick,
    class: className = ''
  }: {
    label: string;
    href?: string;
    onclick?: () => void;
    class?: string;
  } = $props();

  const linkClass = $derived(
    `flex w-fit cursor-pointer items-center gap-1.5 text-xs tracking-widest opacity-50 hover:opacity-80 ${className}`
  );
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
