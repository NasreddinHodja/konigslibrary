import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/// axe's WCAG 2.1 A and AA rules over the page, once its transitions are done.
async function expectNoViolations(page: Page) {
  // Text mid-fade would fail the contrast check. Looping animations (skeletons,
  // spinners) never finish, so they aren't waited for.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => {}))
    )
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // No page zoom, on purpose: the reader pinches its pages itself (see
    // layout.css).
    .disableRules(['meta-viewport'])
    .analyze();
  // Rule id and offending elements, rather than axe's whole report.
  expect(
    violations.map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }))
  ).toEqual([]);
}

async function openManga(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search library' }).fill('unpadded');
  await page.getByRole('button', { name: 'Open Order - Unpadded numbers' }).click();
  await expect(page.getByText('chapters (4)')).toBeVisible();
}

async function openChapter(page: Page) {
  await openManga(page);
  await page.getByRole('button', { name: 'ch1 — 4 pages' }).click();
  await page.getByRole('button', { name: 'Dismiss tutorial' }).click();
  await expect(page.getByRole('button', { name: 'Dismiss tutorial' })).toBeHidden();
}

test('library', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible();
  await expectNoViolations(page);
});

test('manga detail', async ({ page }) => {
  await openManga(page);
  await expectNoViolations(page);
});

test('reader, scrolling', async ({ page }) => {
  await openChapter(page);
  await expectNoViolations(page);
});

test('reader, turning pages', async ({ page }) => {
  await openChapter(page);
  await page.getByRole('button', { name: 'turn / scroll: scroll' }).click();
  await page.getByRole('button', { name: 'Dismiss tutorial' }).click();
  await expect(page.getByRole('region', { name: 'Page 1 of 4' })).toBeVisible();
  await expectNoViolations(page);
});

test('keyboard help', async ({ page }) => {
  await openChapter(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoViolations(page);
});

test('settings', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Logged-in devices' }).getByRole('listitem').first()
  ).toBeVisible();
  await expectNoViolations(page);
});

test.describe('logged out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'log in' })).toBeVisible();
    await expectNoViolations(page);
  });
});
