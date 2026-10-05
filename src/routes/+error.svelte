<script lang="ts">
  import { page } from '$app/state';
</script>

<div class="flex min-h-screen items-center justify-center p-3">
  <div class="flex flex-col items-center gap-3 panel p-6">
    <h1 class="text-4xl text-ink">{page.status}</h1>
    <p>{page.error?.message ?? 'Something went wrong'}</p>
    <a
      href="/"
      class="hit relative flex h-8 items-center border border-ink px-3 text-ink hover:bg-ink hover:text-bg"
      >reload</a
    >
  </div>
</div>
