<script lang="ts">
  import { getBindings, formatKey } from '$lib/keybindings.svelte';
  import Backdrop from '$lib/ui/Backdrop.svelte';

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

<Backdrop onclick={onclose} />

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-label="Keyboard shortcuts"
>
  <div
    class="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto border-2 bg-black p-6 shadow-xl"
  >
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-bold">Keyboard shortcuts</h2>
      <button class="px-2 py-1 text-sm opacity-40 hover:opacity-80" onclick={onclose}>
        Close
      </button>
    </div>

    {#each categories as [category, items] (category)}
      <div class="mb-4">
        <h3 class="mb-2 text-sm font-bold opacity-60">{category}</h3>
        <div class="space-y-1">
          {#each items as binding (binding.action)}
            <div class="flex items-center justify-between py-1">
              <span class="text-sm opacity-80">{binding.label}</span>
              <div class="flex gap-1">
                {#each binding.keys as key (key)}
                  <kbd
                    class="min-w-[1.75rem] border border-white/20 px-1.5 py-0.5 text-center text-xs"
                  >
                    {formatKey(key)}
                  </kbd>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}

    <p class="mt-2 text-xs opacity-30">
      Customize bindings in <a href="/settings" class="underline" onclick={onclose}>Settings</a>
    </p>
  </div>
</div>
