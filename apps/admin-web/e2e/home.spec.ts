import { expect, test } from '@playwright/test';

import { signInAsAdmin } from './auth';

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test('the portal opens on the overview', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Overview · BoothConnect Admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('This page is being built.')).toBeVisible();
});

test('the side navigation moves between Milestone 1 pages', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Roll imports' }).click();
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page).toHaveTitle('Roll imports · BoothConnect Admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Roll imports' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Roll imports' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');

  for (const [name, path] of [
    ['Geography', '/geography'],
    ['Voters and households', '/voters'],
    ['Analytics', '/analytics'],
    ['Users and assignments', '/users'],
    ['Audit and security', '/audit'],
  ] as const) {
    await nav.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
  }
  // Later pages are listed but can't be opened.
  await expect(nav.getByRole('link', { name: /Campaigns/ })).toHaveCount(0);
  await expect(nav.getByText('Campaigns')).toBeVisible();
});

test('"Skip to main content" moves focus past the navigation', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the shell renders in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // The token background differs between the themes.
    expect(background).toBe(colorScheme === 'light' ? 'rgb(243, 245, 250)' : 'rgb(13, 19, 32)');
  });
}
