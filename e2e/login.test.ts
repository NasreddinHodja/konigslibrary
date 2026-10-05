import { test, expect } from '@playwright/test';
import { ADMIN } from './auth';

// Logged out: none of the session global-setup keeps.
test.use({ storageState: { cookies: [], origins: [] } });

test('sends a visitor to the login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'log in' })).toBeVisible();
});

test('logs in to the library', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('username').fill(ADMIN.username);
  await page.getByLabel('password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'library' })).toBeVisible();
  // The session is a cookie, so it survives a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible();
});

test('says when the password is wrong', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('username').fill(ADMIN.username);
  await page.getByLabel('password').fill('not the password');
  await page.getByRole('button', { name: 'log in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong username or password');
  await expect(page).toHaveURL('/login');
});

test('logs out from Settings', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('username').fill(ADMIN.username);
  await page.getByLabel('password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'library' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText(`logged in as ${ADMIN.username}`)).toBeVisible();
  await page.getByRole('button', { name: 'log out', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/');
  await expect(page).toHaveURL('/login');
});
