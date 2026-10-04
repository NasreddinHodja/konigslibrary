import { defineConfig, devices } from '@playwright/test';

// The self-hosted app end to end: klserver serving the simulated library
// (scripts/gen-dev-library.js) behind the Vite dev server.
export default defineConfig({
  testDir: 'e2e',
  // Each test opens its own browser context, so tests share only the server's
  // library, which none of them change.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev:sim',
    url: 'http://localhost:5173/api/ping',
    // A dev:sim already running locally is used as is.
    reuseExistingServer: !process.env.CI,
    // The first run compiles klserver.
    timeout: 300_000
  }
});
