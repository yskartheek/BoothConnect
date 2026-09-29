import { expect, test, type Page } from '@playwright/test';

// The glass panel's computed styles show which design tokens are in effect.
// toHaveCSS retries, so the background transition can finish first.
// The theme and transparency controls are in the top bar's Appearance popover.
async function openAppearance(page: Page) {
  await page.getByRole('button', { name: 'Appearance' }).click();
}

async function expectGlass(page: Page, background: string, blur?: string) {
  const panel = page.getByTestId('glass-panel');
  await expect(panel).toHaveCSS('background-color', background);
  if (blur) await expect(panel).toHaveCSS('backdrop-filter', blur);
}

const LIGHT_GLASS = 'rgba(255, 255, 255, 0.62)';
const DARK_GLASS = 'rgba(22, 27, 36, 0.68)';
const LIGHT_OPAQUE = 'rgb(248, 249, 252)';
const DARK_OPAQUE = 'rgb(22, 29, 43)';

test('light glass by default, dark glass when the system is dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expectGlass(page, LIGHT_GLASS, 'blur(20px)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectGlass(page, DARK_GLASS, 'blur(20px)');
});

test('the theme control overrides the system theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await openAppearance(page);
  const theme = page.getByLabel('Theme');

  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectGlass(page, DARK_GLASS);

  await page.emulateMedia({ colorScheme: 'dark' });
  await theme.selectOption('light');
  await expectGlass(page, LIGHT_GLASS);
});

test('"Reduce transparency" swaps glass for an opaque surface without blur', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await openAppearance(page);
  await page.getByLabel('Reduce transparency').check();
  await expectGlass(page, LIGHT_OPAQUE, 'blur(0px)');

  await page.getByLabel('Theme').selectOption('dark');
  await expectGlass(page, DARK_OPAQUE);

  await page.getByLabel('Reduce transparency').uncheck();
  await expectGlass(page, DARK_GLASS, 'blur(20px)');
});

test('the system reduced-transparency setting is honoured', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  // Playwright has no option for this media feature yet, so ask Chromium directly.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches),
  ).toBe(true);
  await expectGlass(page, LIGHT_OPAQUE, 'blur(0px)');
});

test('reduced motion sets the motion durations to 0', async ({ page }) => {
  // The production CSS minifier may write 220ms as .22s, so compare in milliseconds.
  const durationMs = () =>
    page.evaluate(() => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue('--bc-duration-standard')
        .trim();
      return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
    });
  await page.goto('/');
  expect(await durationMs()).toBe(220);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await durationMs()).toBe(0);
});

test('the choice is remembered after a reload, without a light flash', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await openAppearance(page);
  await page.getByLabel('Theme').selectOption('dark');
  await page.getByLabel('Reduce transparency').check();

  await page.reload();
  // Set by the inline script before the page is painted.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-transparency', 'reduced');
  await expectGlass(page, DARK_OPAQUE);
});
