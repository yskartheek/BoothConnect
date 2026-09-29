import { expect, test } from '@playwright/test';

import { signInAsAdmin } from './auth';
import { expectAccessible } from './axe';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:4100/__reset?only=voters');
});

test('find a voter, see official vs current values, the history and a conflict, and correct a value', async ({
  page,
}) => {
  await signInAsAdmin(page, '/voters');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Voters and households' }),
  ).toBeVisible();

  // Find the household, open it, and open a member.
  await page.getByLabel('Search', { exact: true }).fill('Synthetic Person');
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('button', { name: 'H NO 5-1 · 2 members' }).click();
  const member = page.getByRole('link', { name: 'Synthetic Person One' });
  await expect(member.locator('..')).toContainText('Conflict: two values');
  await expectAccessible(page);
  await member.click();
  await expect(page).toHaveURL(/\/voters\?voter=voter-1$/);

  await expect(page.getByRole('heading', { name: 'Synthetic Person One' })).toBeVisible();
  const table = page.getByRole('table', {
    name: "Each field: the roll's value and the current one",
  });
  const row = (name: string) => table.getByRole('row', { name: new RegExp(`^${name}`) });
  await expect(row('Name')).toContainText('Synthetic Person 1');
  await expect(row('Name')).toContainText('Synthetic Person One Admin · Test Admin');
  await expect(row('Age')).toContainText('34As on the roll');
  await expect(row('Occupation')).toContainText('Not on the rollNot set');

  // The conflict: both values, and no correction here.
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Open conflicts: Mobile number.',
  );
  await expect(row('Mobile number')).toContainText('+919999900101');
  await expect(row('Mobile number')).toContainText('+919999900102');
  await expect(row('Mobile number').getByRole('button', { name: /^Correct/ })).toHaveCount(0);

  // History.
  await table.getByRole('button', { name: 'History of Name (1 earlier values)' }).click();
  await expect(
    table.getByRole('list', { name: 'Earlier values of Name, newest first' }),
  ).toContainText('Synthetic Persen 1');
  await expectAccessible(page);

  // Correct the occupation, then the name (whose old value joins the history).
  await table.getByRole('button', { name: 'Correct Occupation' }).click();
  await table.getByLabel('New value for Occupation').fill('Teacher');
  await table.getByRole('button', { name: 'Save' }).click();
  await expect(row('Occupation')).toContainText('Teacher Admin · Test Admin');
  await table.getByRole('button', { name: 'Correct Name' }).click();
  await table.getByLabel('New value for Name').fill('Synthetic Person 1');
  await table.getByRole('button', { name: 'Save' }).click();
  await expect(
    table.getByRole('button', { name: 'History of Name (2 earlier values)' }),
  ).toBeVisible();

  // A value the API refuses is shown as it is.
  await table.getByRole('button', { name: 'Correct Age' }).click();
  await table.getByLabel('New value for Age').fill('12');
  await table.getByRole('button', { name: 'Save' }).click();
  await expect(table.getByText('age must be between 18 and 120')).toBeVisible();
});

test('an unknown voter says so', async ({ page }) => {
  await signInAsAdmin(page, '/voters?voter=voter-missing');
  await expect(page.getByText("This voter can't be found in your area.")).toBeVisible();
  await page.getByRole('link', { name: 'Back to the search' }).click();
  await expect(page.getByRole('heading', { name: 'Find a voter' })).toBeVisible();
});
