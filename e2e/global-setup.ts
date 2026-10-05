import { chromium, expect, type FullConfig } from '@playwright/test';
import { ADMIN, SETUP_TOKEN, STORAGE_STATE } from './auth';

/// Sets the server up (or logs in, once it is), keeps the session for every
/// test, and loads the library once: on a fresh server Vite compiles the app
/// on its first visit, which can outlast a test's 5s wait for the page.
///
/// A dev:sim that was already running is reused, and has its own admin: stop
/// it first.
export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto('/login');
  const heading = page.getByRole('heading', { level: 1, name: /^(set up the server|log in)$/ });
  await expect(heading).toBeVisible({ timeout: 120_000 });
  if ((await heading.textContent()) === 'set up the server') {
    await page.getByLabel('setup token').fill(SETUP_TOKEN);
  }
  await page.getByLabel('username').fill(ADMIN.username);
  await page.getByLabel('password').fill(ADMIN.password);
  await page.getByLabel('password').press('Enter');
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible({
    timeout: 120_000
  });
  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
