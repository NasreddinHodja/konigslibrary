import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// LOCAL_BUILD makes the client talk to its own origin's API, which in dev is the
// Vite dev server — and the API lives in the klserver binary, not in SvelteKit.
// Without this proxy every /api call falls through to the SPA fallback and comes
// back as HTML.
const apiPort = process.env.KL_SERVER_PORT || '3000';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: process.env.TAURI_DEV_HOST || 'localhost',
    proxy: process.env.LOCAL_BUILD
      ? {
          '/api': {
            target: `http://127.0.0.1:${apiPort}`,
            changeOrigin: false
          }
        }
      : undefined
  },
  define: {
    __LOCAL_BUILD__: JSON.stringify(!!process.env.LOCAL_BUILD)
  }
});
