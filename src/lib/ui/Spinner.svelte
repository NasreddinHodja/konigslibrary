<script lang="ts">
  import { reducedMotion } from '$lib/utils/constants';

  // A text spinner, in the font's own glyphs; still under reduced motion.
  const FRAMES = ['|', '/', '-', '\\'];
  let frame = $state(0);

  $effect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => (frame = (frame + 1) % FRAMES.length), 150);
    return () => clearInterval(id);
  });
</script>

<span class="inline-block w-[1ch] text-ink" aria-hidden="true">{FRAMES[frame]}</span>
