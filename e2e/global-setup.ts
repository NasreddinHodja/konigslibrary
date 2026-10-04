import { chromium, expect, type FullConfig } from '@playwright/test';

/// Loads the library once before any test: on a fresh server Vite compiles the
/// app on its first visit, which can outlast a test's 5s wait for the page.
export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible({
    timeout: 120_000
  });
  await browser.close();
}
