<script lang="ts">
  // Sits under a paged list and asks for the next page as it comes near.
  let { onvisible, watch }: { onvisible: () => void; watch: unknown } = $props();

  let el: HTMLDivElement | undefined = $state();

  // Re-observed whenever `watch` changes (the list grew), so a sentinel still
  // on screen after a page lands fires again.
  $effect(() => {
    void watch;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onvisible();
      },
      { root: el.closest('[data-scroll-root]'), rootMargin: '400px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<div bind:this={el}></div>
