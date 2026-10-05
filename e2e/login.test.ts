import { test, expect } from '@playwright/test';
import { ADMIN } from './auth';

// Logged out: none of the session global-setup keeps.
test.use({ storageState: { cookies: [], origins: [] } });

test('sends a visitor to the login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
});

test('logs in to the library', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  // The session is a cookie, so it survives a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible();
});

test('says when the password is wrong', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong username or password');
  await expect(page).toHaveURL('/login');
});

test('logs out from Settings', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText(`Logged in as ${ADMIN.username}`)).toBeVisible();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/');
  await expect(page).toHaveURL('/login');
});
