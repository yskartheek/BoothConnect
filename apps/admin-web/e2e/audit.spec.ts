import { expect, test } from '@playwright/test';

import { signInAsAdmin } from './auth';
import { expectAccessible } from './axe';

test('filter by action, open an event, and verify the chain', async ({ page }) => {
  await signInAsAdmin(page, '/audit');
  await expect(page.getByRole('heading', { level: 1, name: 'Audit and security' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Audit events, newest first' });
  await expect(table.getByRole('row')).toHaveCount(6);

  // Filter by action: the filters go into the address.
  await page.getByLabel('Action', { exact: true }).fill('import.*');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/\/audit\?action=import\.\*$/);
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table).not.toContainText('auth.login');
  await expectAccessible(page);

  // A reload keeps the filters.
  await page.reload();
  await expect(page.getByLabel('Action', { exact: true })).toHaveValue('import.*');
  await expect(table.getByRole('row')).toHaveCount(3);

  // Open an event: its details and the redacted metadata.
  await table.getByRole('button', { name: 'Details of import.file.committed (event 3)' }).click();
  const drawer = page.getByRole('dialog', { name: 'import.file.committed' });
  await expect(drawer).toContainText('System');
  await expect(drawer.getByLabel('Details recorded')).toContainText('"householdsCreated": 33');
  await expectAccessible(page);
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);

  // Verify the chain.
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(
    page.getByText('The chain is intact: 5 events checked, none changed.'),
  ).toBeVisible();

  // A filter the API refuses says why.
  await page.getByLabel('Action', { exact: true }).fill('Not An Action');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'These filters can\'t be used: action must look like "auth.login" or "import.*"',
  );
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(table.getByRole('row')).toHaveCount(6);
});
