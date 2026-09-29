import { expect, test } from '@playwright/test';

import { signInAsAdmin } from './auth';
import { expectAccessible } from './axe';

test('drill down from the AC to a part to a polling station', async ({ page }) => {
  await signInAsAdmin(page, '/analytics');
  await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();

  // The admin's AC opens first: 420 + 380 electors at its two stations.
  await expect(
    page.getByRole('heading', { name: 'AC 101 Demo Assembly Constituency' }),
  ).toBeVisible();
  const electors = page.getByRole('article', { name: 'Electors' });
  await expect(electors.getByText('800', { exact: true })).toBeVisible();
  // Small groups are "<10", never 0; field work isn't collected yet.
  await expect(
    electors.locator('.figure-item', { has: page.locator('dt', { hasText: /^Third gender$/ }) }),
  ).toContainText('<10');
  await expect(
    page.getByRole('article', { name: 'Field work' }).getByText('Not collected').first(),
  ).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Compared with PC 1 Demo Parliamentary Constituency' }),
  ).toHaveCount(0);
  await expectAccessible(page);

  // Parts of the AC, then drill down.
  const parts = page.getByRole('table', {
    name: 'Figures for each place below, with the total and the average',
  });
  await expect(parts.getByRole('row', { name: /1 Demo Nagar/ })).toContainText('800');
  await parts.getByRole('link', { name: '1 Demo Nagar' }).click();
  await expect(page).toHaveURL(/\/analytics\?node=/);
  await expect(page.getByRole('heading', { name: 'Part 1 Demo Nagar' })).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Compared with AC 101 Demo Assembly Constituency' }),
  ).toBeVisible();

  // Its stations, sorted by electors (highest first), then down to one.
  const stations = page.getByRole('table', {
    name: 'Figures for each place below, with the total and the average',
  });
  await stations.getByRole('button', { name: /^Electors/ }).click();
  await expect(stations.locator('tbody tr').first()).toContainText('1 Demo Primary School, Room 1');
  await expect(stations.locator('tbody tr').first()).toContainText('420');
  await stations.getByRole('link', { name: '1A Demo Primary School, Room 2' }).click();
  await expect(
    page.getByRole('heading', { name: 'Polling station 1A Demo Primary School, Room 2' }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Electors' }).getByText('380', { exact: true }),
  ).toBeVisible();
  // A station has nothing below it.
  await expect(page.getByRole('table', { name: /Figures for each place below/ })).toHaveCount(0);
  await expectAccessible(page);

  // Back up through the breadcrumbs.
  const crumbs = page.getByRole('navigation', { name: 'Where you are' });
  await expect(crumbs.getByRole('listitem')).toHaveText([
    'State S99 Demo State',
    'PC 1 Demo Parliamentary Constituency',
    'AC 101 Demo Assembly Constituency',
    'Part 1 Demo Nagar',
    'Polling station 1A Demo Primary School, Room 2',
  ]);
  // Above the admin's AC isn't theirs to open.
  await expect(crumbs.getByRole('link', { name: 'State S99 Demo State' })).toHaveCount(0);
  await crumbs.getByRole('link', { name: 'AC 101 Demo Assembly Constituency' }).click();
  await expect(
    page.getByRole('heading', { name: 'AC 101 Demo Assembly Constituency' }),
  ).toBeVisible();
});

test('go to a place with the picker', async ({ page }) => {
  await signInAsAdmin(page, '/analytics');
  const picker = page.getByRole('group', { name: 'Go to a place' });
  await picker.getByLabel('Your area').selectOption({ label: 'AC 101 Demo Assembly Constituency' });
  await picker.getByLabel('Part').selectOption({ label: '1 Demo Nagar' });
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Part 1 Demo Nagar' })).toBeVisible();
});
