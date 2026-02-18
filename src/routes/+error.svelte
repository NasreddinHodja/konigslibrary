<script lang="ts">
  import { page } from '$app/state';
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
  <h1 class="text-4xl font-bold">{page.status}</h1>
  <p class="text-sm opacity-60">{page.error?.message ?? 'Something went wrong'}</p>
  <a href="/" class="border-2 px-4 py-2 text-sm hover:bg-white/10">Reload</a>
</div>
