<script lang="ts">
  import { fade } from 'svelte/transition';
  import { manga } from '$lib/state.svelte';

  let currentUrl: string | null = $state(null);

  $effect(() => {
    const chapter = manga.selectedChapter;
    if (!chapter) return;

    const url = URL.createObjectURL(chapter.files[manga.currentPage]);
    currentUrl = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  });

  $effect(() => {
    manga.selectedChapter?.files;
    manga.currentPage = 0;
  });

  const prev = () => {
    if (manga.currentPage > 0) manga.currentPage--;
  };

  const next = () => {
    const chapter = manga.selectedChapter;
    if (chapter && manga.currentPage < chapter.files.length - 1) manga.currentPage++;
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      prev();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      next();
    }
  };

  const handleClick = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.clientX < rect.left + rect.width / 2) {
      prev();
    } else {
      next();
    }
  };
</script>

<svelte:window onkeydown={handleKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex h-full flex-1 cursor-pointer items-center justify-center bg-black"
  onclick={handleClick}
>
  {#key manga.currentPage}
    {#if currentUrl}
      <img
        transition:fade={{ duration: 150 }}
        src={currentUrl}
        alt="manga page"
        class="max-h-full object-contain"
      />
    {/if}
  {/key}
</div>
