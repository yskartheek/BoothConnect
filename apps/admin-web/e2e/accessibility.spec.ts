import { expect, type Locator, type Page, test } from '@playwright/test';

import { ADMIN, CODE, signIn, signInAsAdmin, VOLUNTEER } from './auth';
import { expectAccessible } from './axe';

// #77: every Milestone 1 page, in both themes, has no serious or critical axe
// violations; and the import wizard works from the keyboard alone.

const PORTAL_PAGES = [
  ['/', 'Overview'],
  ['/imports', 'Roll imports'],
  ['/geography', 'Geography'],
  ['/voters', 'Voters and households'],
  ['/analytics', 'Analytics'],
  ['/users', 'Users and assignments'],
  ['/audit', 'Audit and security'],
] as const;

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme });
    });

    test('sign-in, MFA and denied pages', async ({ page }) => {
      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await expectAccessible(page);

      await page.getByLabel('Phone number').fill(ADMIN);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.getByLabel('Code')).toBeVisible();
      await expectAccessible(page);

      // A wrong code shows the error state.
      await page.getByLabel('Code').fill('000000');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
      await expectAccessible(page);

      await page.getByLabel('Code').fill(CODE);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Two-step verification' }),
      ).toBeVisible();
      await expectAccessible(page);
    });

    test('the denied page', async ({ page }) => {
      await signIn(page, VOLUNTEER, '/sign-in');
      await expect(page.getByRole('heading', { level: 1, name: 'No access' })).toBeVisible();
      await expectAccessible(page);
    });

    test('every portal page', async ({ page }) => {
      await signInAsAdmin(page);
      for (const [path, heading] of PORTAL_PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        // Wait for the page's data, not its loading state.
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
        await expectAccessible(page);
      }
    });

    test('the Appearance popover', async ({ page }) => {
      await signInAsAdmin(page);
      await page.getByRole('button', { name: 'Appearance' }).click();
      await expect(page.getByLabel('Theme')).toBeVisible();
      await expectAccessible(page);
    });
  });
}

/** The focused element shows the focus ring. */
async function expectVisibleFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  const ring = await locator.evaluate((el) => {
    // A visually hidden input shows its focus on its label instead.
    const target =
      el instanceof HTMLInputElement && el.type === 'file' && el.labels?.[0] ? el.labels[0] : el;
    const style = getComputedStyle(target);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
}

/** Presses Tab until `target` has focus, checking each stop shows focus. */
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) {
      await expectVisibleFocus(target);
      return;
    }
    const focused = page.locator(':focus');
    if ((await focused.count()) > 0) await expectVisibleFocus(focused);
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

// Synthetic stand-ins for roll PDFs: never real rolls.
const run = `${process.pid}-${Date.now()}`;
const roll = (name: string, text: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n% synthetic test roll: ${text} ${run}\n%%EOF\n`),
});

test('the import wizard, from the keyboard alone', async ({ page, request }) => {
  await request.post('http://localhost:4100/__reset?only=imports');
  await signInAsAdmin(page, '/imports');
  await expect(page.getByRole('heading', { level: 1, name: 'Roll imports' })).toBeVisible();

  // Step 1: choose the AC. Selects change with the arrow keys.
  const area = page.getByLabel('Your area');
  await tabTo(page, area);
  await area.selectOption({ label: 'AC 101 Demo Assembly Constituency' });
  await expect(area).toBeFocused();
  const cont = page.getByRole('button', { name: 'Continue' });
  await tabTo(page, cont);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/step=upload$/);

  // Step 2: the file input is reached by Tab, and opens the file chooser from the keyboard.
  const input = page.getByLabel('Choose PDF or ZIP files');
  await tabTo(page, input);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (
    await chooser
  ).setFiles([roll('part-1.pdf', 'ready'), roll('part-1-review.pdf', 'needs review')]);
  const upload = page.getByRole('button', { name: 'Upload files (2)' });
  await tabTo(page, upload);
  await page.keyboard.press('Enter');
  const list = page.getByRole('list', { name: 'Files to upload' });
  await expect(list.getByText('Uploaded', { exact: true })).toHaveCount(2);
  // Each upload's progress bar has an accessible name.
  await expect(list.getByRole('progressbar')).toHaveCount(2);
  for (const bar of await list.getByRole('progressbar').all()) {
    await expect(bar).toHaveAccessibleName(/part-1/);
  }
  await expectAccessible(page);

  const next = page.getByRole('link', { name: 'Next: extraction' });
  await tabTo(page, next);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/step=extract$/);

  // Step 3: the table's status is announced in a live region as it changes.
  const status = page.getByRole('status').filter({ hasText: 'Files extracted' });
  await expect(status).toHaveText('Files extracted: 2 of 2. Every file has finished.', {
    timeout: 15_000,
  });
  const table = page.getByRole('table', { name: 'Every file of this import' });
  await expect(table.getByRole('columnheader')).toHaveCount(8);
  await expectAccessible(page);

  // The filter and the review link are reachable, and labelled.
  const show = page.getByLabel('Show');
  await tabTo(page, show);
  await show.selectOption({ label: 'Ready (1)' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await show.selectOption({ label: 'All files (2)' });
  await tabTo(page, table.getByRole('link', { name: 'Review part-1-review.pdf' }));

  // The confirm dialog: focus moves in, Escape closes it and focus comes back.
  const confirm = page.getByRole('button', { name: 'Confirm all ready files (1)' });
  await confirm.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: 'Confirm the ready files?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await expectVisibleFocus(dialog.locator(':focus'));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(confirm).toBeFocused();

  // Open it again and confirm with the keyboard.
  await page.keyboard.press('Enter');
  await tabTo(page, dialog.getByRole('button', { name: 'Confirm all ready files (1)' }), 4);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Files being confirmed: 1.' }),
  ).toBeVisible();
  await expect(table.getByRole('row', { name: /^part-1\.pdf/ })).toContainText('Confirmed', {
    timeout: 15_000,
  });
});
