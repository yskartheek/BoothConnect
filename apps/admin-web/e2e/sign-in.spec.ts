import { expect, test } from '@playwright/test';

import { ADMIN, signIn, signInAsAdmin, VOLUNTEER } from './auth';

test('an admin signs in, passes the MFA step and lands where they were going', async ({
  page,
  context,
}) => {
  await page.goto('/users');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fusers$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  await signIn(page, ADMIN, '/sign-in?next=%2Fusers');
  await expect(page).toHaveURL(/\/sign-in\/mfa\?next=%2Fusers$/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Users and assignments' }),
  ).toBeVisible();
  // The name comes from /v1/me, through this server's /api.
  await expect(page.getByText('Test Admin')).toBeVisible();

  // The tokens are httpOnly cookies: page scripts can't read them.
  const cookies = await context.cookies();
  for (const name of ['bc_access', 'bc_refresh']) {
    expect(cookies.find((c) => c.name === name)).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  }
  expect(await page.evaluate(() => document.cookie)).toBe('');
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toMatch(/access|refresh/);
});

test('a volunteer is denied and not signed in', async ({ page, context }) => {
  await signIn(page, VOLUNTEER, '/sign-in');
  await expect(page).toHaveURL(/\/denied$/);
  await expect(page.getByRole('heading', { level: 1, name: 'No access' })).toBeVisible();
  await expect(page.getByText('This portal is for admins')).toBeVisible();
  expect((await context.cookies()).filter((c) => c.name === 'bc_access' && c.value)).toEqual([]);
  // The portal stays closed.
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('a wrong code is refused', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Phone number').fill(ADMIN);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'That code is wrong or has expired.',
  );
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('the portal waits for the MFA step, and signing out closes it again', async ({ page }) => {
  await signIn(page, ADMIN, '/sign-in');
  await expect(page).toHaveURL(/\/sign-in\/mfa$/);
  // Skipping the step doesn't open the portal.
  await page.goto('/audit');
  await expect(page).toHaveURL(/\/sign-in\/mfa$/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/audit');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faudit$/);
});

test('this server’s /api never hands out the API’s tokens', async ({ page }) => {
  await signInAsAdmin(page);
  const res = await page.request.post('/api/v1/auth/otp/verify', {
    data: { phone: ADMIN, code: '123456', deviceId: 'x' },
  });
  expect(res.status()).toBe(404);
});
