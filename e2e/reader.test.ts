import { test, expect, type Page } from '@playwright/test';

// One of the fixed "Order - …" manga of the simulated library: four chapters
// of four pages, whatever --count it was generated with.
const MANGA = 'Order - Unpadded numbers';

async function openManga(page: Page) {
  await page.getByRole('textbox', { name: 'Search library' }).fill('unpadded');
  await page.getByRole('button', { name: `Open ${MANGA}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: MANGA })).toBeVisible();
}

/// Opens the first chapter and clears the tutorial off it.
async function openFirstChapter(page: Page) {
  await page.getByRole('button', { name: 'ch1 — 4 pages' }).click();
  await page.getByRole('button', { name: 'Dismiss tutorial' }).click();
  await expect(page.getByRole('button', { name: 'Dismiss tutorial' })).toBeHidden();
}

// The scroll viewer's HUD counts through the pages in between while it
// smooth-scrolls; with reduced motion it jumps, so each page turn lands at once.
test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('lists the library', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible();
});

test('searches the library', async ({ page }) => {
  const search = page.getByRole('textbox', { name: 'Search library' });
  await search.fill('unpadded');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: `Open ${MANGA}` })).toBeVisible();

  await search.fill('no such manga');
  await expect(page.getByText('No results for "no such manga"')).toBeVisible();

  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Open / }).nth(1)).toBeVisible();
});

test('opens a manga at its chapters', async ({ page }) => {
  await openManga(page);
  await expect(page.getByText('CHAPTERS (4)')).toBeVisible();
  const tiles = page.getByRole('button', { name: / — 4 pages$/ });
  await expect(tiles).toHaveCount(4);
  for (const [i, chapter] of ['ch1', 'ch1.5', 'ch2', 'ch10'].entries()) {
    await expect(tiles.nth(i)).toHaveAccessibleName(`${chapter} — 4 pages`);
  }
});

test('opens a chapter and pages through it', async ({ page }) => {
  await openManga(page);
  await openFirstChapter(page);
  await expect(page.getByRole('region', { name: 'Manga pages' })).toBeVisible();
  await expect(page.getByText(MANGA, { exact: true })).toBeVisible();
  await expect(page.getByText('ch1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1/4' })).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '2/4' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '3/4' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: '2/4' })).toBeVisible();
});

test('dismisses the tutorial from the keyboard', async ({ page }) => {
  await openManga(page);
  await page.getByRole('button', { name: 'ch1 — 4 pages' }).click();
  const tutorial = page.getByRole('button', { name: 'Dismiss tutorial' });
  await expect(tutorial).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tutorial).toBeHidden();
});

test('pages through in page-turn mode', async ({ page }) => {
  await openManga(page);
  await openFirstChapter(page);
  await page.getByRole('button', { name: 'Turn / Scroll: Scroll' }).click();
  await page.getByRole('button', { name: 'Dismiss tutorial' }).click();

  const viewer = page.getByRole('region', { name: /^Page \d+ of 4$/ });
  await expect(viewer).toHaveAccessibleName('Page 1 of 4');
  await page.keyboard.press('ArrowRight');
  await expect(viewer).toHaveAccessibleName('Page 2 of 4');
  await page.keyboard.press('ArrowLeft');
  await expect(viewer).toHaveAccessibleName('Page 1 of 4');
});

test('picks up where the manga was left after a reload', async ({ page }) => {
  await openManga(page);
  await openFirstChapter(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '3/4' })).toBeVisible();
  // Progress is saved once the page has settled for a moment.
  await expect
    .poll(() => page.evaluate((m) => localStorage.getItem(`kl:progress:${m}`), MANGA))
    .toContain('"page":2');

  await page.reload();
  await openManga(page);
  await page.getByRole('button', { name: 'resume ch1 p. 3' }).click();
  await expect(page.getByText(MANGA, { exact: true })).toBeVisible();
  await expect(page.getByText('ch1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '3/4' })).toBeVisible();
});
