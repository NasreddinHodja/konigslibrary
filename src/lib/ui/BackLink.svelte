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
    'hit relative flex w-fit cursor-pointer items-center text-ink hover:text-hi hover:underline';
  // The chevron in the reader's back button's box, so it's as far from the
  // edge as from the label.
  const iconClass = 'flex size-8 shrink-0 items-center justify-center pointer-coarse:size-10';
</script>

{#if href}
  <a {href} class={linkClass}
    ><span class={iconClass}><Icon name="back" size={18} /></span>{label}</a
  >
{:else}
  <button class={linkClass} {onclick}
    ><span class={iconClass}><Icon name="back" size={18} /></span>{label}</button
  >
{/if}
