import { defineConfig, devices } from '@playwright/test';
import { SETUP_TOKEN, STORAGE_STATE } from './e2e/auth';

// The self-hosted app end to end: klserver serving the simulated library
// (scripts/gen-dev-library.js) behind the Vite dev server.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // Each test opens its own browser context, so tests share only the server's
  // library, which none of them change.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    storageState: STORAGE_STATE,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A server of its own to set up: its index and accounts live in
    // test-results/, which every run starts by deleting.
    command: 'mkdir -p test-results && bun run dev:sim',
    env: {
      KL_DB: 'test-results/e2e.db',
      KL_AUTH_DB: 'test-results/e2e-auth.db',
      KL_SETUP_TOKEN: SETUP_TOKEN
    },
    url: 'http://localhost:5173/api/ping',
    // A dev:sim already running locally is used as is.
    reuseExistingServer: !process.env.CI,
    // The first run compiles klserver.
    timeout: 300_000
  }
});
