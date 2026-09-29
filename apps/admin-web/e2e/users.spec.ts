import { expect, test } from '@playwright/test';

import { VOLUNTEER, signIn, signInAsAdmin } from './auth';
import { expectAccessible } from './axe';

// These tests share the mock API's users: one at a time, from the seed.
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:4100/__reset');
});

test('list and filter the users of the area', async ({ page }) => {
  await signInAsAdmin(page, '/users');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Users and assignments' }),
  ).toBeVisible();
  const list = page.getByRole('table', { name: 'Users in your area and their active roles' });
  await expect(list.getByRole('row', { name: /Test Volunteer/ })).toContainText(
    'Volunteer · Polling station 1 Demo Primary School, Room 1',
  );
  await expect(list.getByRole('row', { name: /Demo Manager/ })).toContainText(
    'Campaign manager · Part 1 Demo Nagar',
  );
  // Active roles only by default: the former volunteer is hidden.
  await expect(list.getByText('Former Volunteer')).toHaveCount(0);
  await expectAccessible(page);

  const people = page.getByRole('region', { name: 'People in your area' });
  await people.getByLabel('Only people with an active role').uncheck();
  await expect(list.getByRole('row', { name: /Former Volunteer/ })).toContainText('No active role');

  await people.getByLabel('Role', { exact: true }).selectOption('campaign_manager');
  await expect(list.getByRole('row')).toHaveCount(2);
  await expect(list.getByText('Demo Manager')).toBeVisible();
  await people.getByLabel('Role', { exact: true }).selectOption('');

  await people.getByLabel('Name or phone').fill('+91999990000');
  await expect(list.getByRole('row')).toHaveCount(5);
  await people.getByLabel('Name or phone').fill('former');
  await expect(list.getByRole('row')).toHaveCount(2);
  await people.getByLabel('Name or phone').fill('');

  // The area picker starts at the admin's AC: nothing above it is offered.
  await expect(people.getByLabel('Your area').locator('option')).toHaveText([
    'All of my area',
    'AC 101 Demo Assembly Constituency',
  ]);
  await people.getByLabel('Your area').selectOption({ label: 'AC 101 Demo Assembly Constituency' });
  await people.getByLabel('Part').selectOption({ label: '1 Demo Nagar' });
  await people
    .getByLabel('Polling station')
    .selectOption({ label: '1 Demo Primary School, Room 1' });
  await expect(list.getByRole('row')).toHaveCount(3);
  await expect(list.getByText('Demo Manager')).toHaveCount(0);
  await expect(people.getByLabel('Polling station').locator('option')).toContainText([
    '1A Demo Primary School, Room 2 · Auxiliary',
  ]);
});

test('add a volunteer to a booth, see them listed, end the role and see it in the history', async ({
  page,
}) => {
  await signInAsAdmin(page, '/users');
  await page.getByRole('button', { name: 'Add a user' }).click();
  const form = page.getByRole('region', { name: 'Add a user' });
  await form.getByLabel('Name').fill('Test New Volunteer');
  await form.getByLabel('Phone number').fill('+919999900150');
  await form.getByLabel('Your area').selectOption({ label: 'AC 101 Demo Assembly Constituency' });
  // A volunteer needs a polling station.
  await form.getByRole('button', { name: 'Add user' }).click();
  await expect(form.getByRole('alert')).toHaveText('Volunteers are assigned to a polling station.');
  await form.getByLabel('Part').selectOption({ label: '1 Demo Nagar' });
  await form.getByLabel('Polling station').selectOption({ label: '1 Demo Primary School, Room 1' });
  await expectAccessible(page);
  await form.getByRole('button', { name: 'Add user' }).click();

  await expect(
    page.getByRole('status').filter({ hasText: 'Test New Volunteer was added.' }),
  ).toBeVisible();
  const list = page.getByRole('table', { name: 'Users in your area and their active roles' });
  await expect(list.getByRole('row', { name: /Test New Volunteer/ })).toContainText(
    'Volunteer · Polling station 1',
  );

  // Their details opened: end the role.
  const history = page.getByRole('table', { name: /Roles of Test New Volunteer/ });
  await expect(history.getByRole('row').nth(1)).toContainText('Active');
  await history
    .getByRole('button', { name: 'End Volunteer at Polling station 1 Demo Primary School, Room 1' })
    .click();
  const dialog = page.getByRole('alertdialog', { name: 'End this role?' });
  await expect(dialog).toContainText('The role stays in their history.');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'End role' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(history.getByRole('row').nth(1)).toContainText('Ended');
  await expect(history.getByRole('button', { name: /^End/ })).toHaveCount(0);
  // No longer in the list of people with an active role.
  await expect(list.getByText('Test New Volunteer')).toHaveCount(0);
});

test('adding someone whose phone can’t be used says so', async ({ page }) => {
  await signInAsAdmin(page, '/users');
  await page.getByRole('button', { name: 'Add a user' }).click();
  const form = page.getByRole('region', { name: 'Add a user' });
  await form.getByLabel('Name').fill('Test Other');
  await form.getByLabel('Phone number').fill('+919999900999');
  await form.getByLabel('Role', { exact: true }).selectOption('campaign_manager');
  await form.getByLabel('Your area').selectOption({ label: 'AC 101 Demo Assembly Constituency' });
  await form.getByRole('button', { name: 'Add user' }).click();
  await expect(form.getByRole('alert')).toHaveText("This phone number can't be used.");
});

test('the admin can’t end their own admin role', async ({ page }) => {
  await signInAsAdmin(page, '/users');
  await page.getByRole('button', { name: 'Open Test Admin' }).click();
  const history = page.getByRole('table', { name: /Roles of Test Admin/ });
  await expect(history).toContainText('Admin');
  await expect(history).toContainText('Server setup');
  await expect(history.getByRole('button', { name: /^End/ })).toHaveCount(0);
});

test('a volunteer gets the denied state', async ({ page }) => {
  await signIn(page, VOLUNTEER, '/sign-in?next=%2Fusers');
  await expect(page).toHaveURL(/\/denied$/);
  await expect(page.getByRole('heading', { level: 1, name: 'No access' })).toBeVisible();
  await expectAccessible(page);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fusers$/);
});
