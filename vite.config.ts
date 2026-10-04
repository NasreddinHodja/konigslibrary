import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

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
  },
  test: {
    // Undoes every vi.stubGlobal (the fake server's fetch) and vi.spyOn after
    // each test.
    unstubGlobals: true,
    restoreMocks: true,
    // And forgets what every vi.fn() was called with.
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['src/**/*.test.ts', 'src/lib/testing/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html', 'json-summary', 'lcov']
    },
    projects: [
      // Plain modules run in node. Anything with runes or a component needs
      // Svelte's browser build and a DOM, so it is named *.svelte.test.ts.
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.svelte.test.ts']
        }
      },
      {
        extends: true,
        plugins: [svelteTesting()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.svelte.test.ts'],
          setupFiles: ['src/lib/testing/setup-dom.ts'],
          // The benches time the parser, which runs in node.
          benchmark: { include: [] }
        }
      }
    ]
  }
});
