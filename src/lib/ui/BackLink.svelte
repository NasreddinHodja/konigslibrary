<script lang="ts">
  import Icon from './Icon.svelte';
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
    'hit relative flex w-fit cursor-pointer items-center gap-2 text-ink hover:text-hi hover:underline';
</script>

{#if href}
  <a {href} class={linkClass}><Icon name="back" size={18} />{label}</a>
{:else}
  <button class={linkClass} {onclick}><Icon name="back" size={18} />{label}</button>
{/if}
