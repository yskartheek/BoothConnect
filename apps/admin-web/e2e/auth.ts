import { expect, type Page } from '@playwright/test';

export const ADMIN = '+919999900001';
export const VOLUNTEER = '+919999900002';
export const CODE = '123456';

/** Signs in through the sign-in page (against e2e/mock-api.mjs). */
export async function signIn(page: Page, phone = ADMIN, path = '/') {
  await page.goto(path);
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill(CODE);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in as the admin and passes the MFA step. */
export async function signInAsAdmin(page: Page, path = '/') {
  await signIn(page, ADMIN, path);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Two-step verification' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}
