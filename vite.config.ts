import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: process.env.TAURI_DEV_HOST || 'localhost'
  },
  define: {
    __LOCAL_BUILD__: JSON.stringify(!!process.env.LOCAL_BUILD)
  }
});
