<script lang="ts">
  import { getBindings, formatKey } from '$lib/keyboard/keybindings.svelte';
  import Modal from '$lib/ui/Modal.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const bindings = $derived(getBindings());

  const categories = $derived.by(() => {
    const map = new Map<string, typeof bindings>(); // eslint-disable-line svelte/prefer-svelte-reactivity
    for (const b of bindings) {
      const list = map.get(b.category) ?? [];
      list.push(b);
      map.set(b.category, list);
    }
    return Array.from(map.entries());
  });
</script>

<Modal
  label="Keyboard shortcuts"
  {onclose}
  class="max-h-[calc(100vh-2rem)] max-w-lg overflow-y-auto p-4"
>
  <div class="mb-3 flex items-center justify-between border-b border-ink">
    <h2 class="text-2xl">keyboard shortcuts</h2>
    <button class="cursor-pointer text-ink hover:text-hi hover:underline" onclick={onclose}>
      close
    </button>
  </div>

  {#each categories as [category, items] (category)}
    <div class="mb-3">
      <h3 class="text-dim">{category.toLowerCase()}</h3>
      {#each items as binding (binding.action)}
        <div class="flex items-center justify-between gap-3 border-b border-ink3 py-1">
          <span>{binding.label}</span>
          <div class="flex gap-1">
            {#each binding.keys as key (key)}
              <kbd class="min-w-7 border border-ink px-1 text-center text-ink">{formatKey(key)}</kbd
              >
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/each}

  <p class="text-dim">
    Change them in <a href="/settings" class="text-ink underline hover:text-hi" onclick={onclose}
      >Settings</a
    >
  </p>
</Modal>
