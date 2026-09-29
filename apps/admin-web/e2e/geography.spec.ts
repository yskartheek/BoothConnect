import path from 'node:path';

import { expect, test } from '@playwright/test';

import { signInAsAdmin } from './auth';

const TEMPLATE = path.join(__dirname, '../public/templates/geography-master.csv');

// These tests share the mock API's geography: one at a time, from the seed.
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:4100/__reset?only=geography');
});

test('upload the synthetic template, check it, confirm it, and see the new ACs', async ({
  page,
}) => {
  await signInAsAdmin(page, '/geography');
  await expect(page.getByRole('heading', { level: 1, name: 'Geography' })).toBeVisible();

  // The template can be downloaded.
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download the template CSV' }).click();
  expect((await download).suggestedFilename()).toBe('geography-master.csv');

  // Check: nothing is saved yet.
  await page.getByLabel('CSV file').setInputFiles(TEMPLATE);
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('6 to add, 0 to update, 0 unchanged, 0 with errors')).toBeVisible();
  const tree = page.getByRole('region', { name: 'Current hierarchy' });
  await expect(tree.getByText('Sample State')).toHaveCount(0);

  // Confirm, and the new State → PC → AC appear in the tree.
  await page.getByRole('button', { name: 'Save 6 changes' }).click();
  await expect(page.getByText('Saved: 6 added, 0 updated.')).toBeVisible();
  await expect(tree.getByText('Sample State')).toBeVisible();
  await expect(tree.getByText('Riverside Sample Assembly Constituency')).toBeVisible();

  // Checking the same file again changes nothing.
  await page.getByLabel('CSV file').setInputFiles(TEMPLATE);
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('0 to add, 0 to update, 6 unchanged, 0 with errors')).toBeVisible();
  await expect(page.getByText('Everything in this file is already saved.')).toBeVisible();
});

test('a file with errors shows the reasons and can’t be saved', async ({ page }) => {
  await signInAsAdmin(page, '/geography');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('level,code,name,reservation,parent_code\nac,77,Orphan AC,,99\n'),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('Unknown PC 99')).toBeVisible();
  await expect(page.getByText(/Nothing has been saved/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Save \d+ changes/ })).toHaveCount(0);
});

test('the tree: search, read-only parts and stations, and an inline edit', async ({ page }) => {
  await signInAsAdmin(page, '/geography');
  const tree = page.getByRole('region', { name: 'Current hierarchy' });
  await expect(tree.getByText('Demo Assembly Constituency')).toBeVisible();

  // Parts and stations come from roll imports: shown, not editable.
  await tree.getByRole('button', { name: 'AC 101 Demo Assembly Constituency' }).click();
  await tree.getByRole('button', { name: 'Part 1 Demo Nagar' }).click();
  await expect(tree.getByText('Demo Primary School, Room 2')).toBeVisible();
  await expect(tree.getByText('Auxiliary')).toBeVisible();
  await expect(tree.getByText('From roll imports').first()).toBeVisible();
  await expect(tree.getByRole('button', { name: /Edit 1A/ })).toHaveCount(0);

  // Search keeps the path down to a match.
  await tree.getByLabel('Search by code or name').fill('zzz');
  await expect(tree.getByText('No State, PC or AC matches your search.')).toBeVisible();
  await tree.getByLabel('Search by code or name').fill('101');
  await expect(tree.getByText('Demo Parliamentary Constituency')).toBeVisible();
  await tree.getByLabel('Search by code or name').fill('');

  // Edit the AC's reservation.
  await tree.getByRole('button', { name: 'Edit 101 Demo Assembly Constituency' }).click();
  await tree.getByLabel('Reservation').fill('SC');
  await tree.getByRole('button', { name: 'Save' }).click();
  await expect(
    tree.getByRole('button', { name: 'Edit 101 Demo Assembly Constituency' }),
  ).toBeVisible();
  const acRow = tree.locator('.tree-row', { hasText: 'Demo Assembly Constituency' });
  await expect(acRow.locator('.badge')).toHaveText('SC');
});
