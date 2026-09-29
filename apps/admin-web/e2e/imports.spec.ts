import { expect, type Page, test } from '@playwright/test';

import { signInAsAdmin } from './auth';
import { expectAccessible } from './axe';

// Synthetic stand-ins for roll PDFs: never real rolls.
// Unique per run, so runs side by side never share a checksum.
const run = `${process.pid}-${Date.now()}`;
const roll = (name: string, text: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n% synthetic test roll: ${text} ${run}\n%%EOF\n`),
});

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:4100/__reset?only=imports');
});

async function startAt(page: Page, part?: string) {
  await signInAsAdmin(page, '/imports');
  await expect(page.getByRole('heading', { level: 1, name: 'Roll imports' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Import steps' }).locator('[aria-current="step"]'),
  ).toHaveText('1Choose level');
  await page.getByLabel('Your area').selectOption({ label: 'AC 101 Demo Assembly Constituency' });
  if (part) await page.getByLabel('Part', { exact: true }).selectOption({ label: part });
}

test('choose the AC, upload synthetic PDFs, and see a duplicate as already imported', async ({
  page,
}) => {
  await startAt(page);
  // The breadcrumb starts at the State above the admin's AC.
  await expect(
    page.getByRole('navigation', { name: 'Chosen place' }).getByRole('listitem'),
  ).toHaveText([
    'State S99 Demo State',
    'PC 1 Demo Parliamentary Constituency',
    'AC 101 Demo Assembly Constituency',
  ]);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  // The batch is in the URL.
  await expect(page).toHaveURL(/\/imports\?batch=batch-\d+&step=upload$/);
  await expect(page.getByText('Importing into AC 101 Demo Assembly Constituency.')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Import steps' }).locator('[aria-current="step"]'),
  ).toHaveText('2Upload');

  await page
    .getByLabel('Choose PDF or ZIP files')
    .setInputFiles([roll('part-1.pdf', 'A'), roll('part-2.pdf', 'B'), roll('notes.txt', 'C')]);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'notes.txt: only PDF and ZIP files can be uploaded',
  );
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Upload files (2)' }).click();
  const list = page.getByRole('list', { name: 'Files to upload' });
  await expect(list.getByText('Uploaded', { exact: true })).toHaveCount(2);
  await expect(list.getByText('Extracting')).toHaveCount(2);

  // The same content again, under another name: already imported, not an error.
  await page.getByLabel('Choose PDF or ZIP files').setInputFiles([roll('part-1-copy.pdf', 'A')]);
  await page.getByRole('button', { name: 'Upload files (1)' }).click();
  const copy = list.getByRole('listitem').filter({ hasText: 'part-1-copy.pdf' });
  await expect(copy.getByText('Already imported')).toBeVisible();
  await expect(copy.getByRole('alert')).toHaveCount(0);

  // Reloading comes back to the batch, with its files.
  await page.reload();
  const files = page.getByRole('table', { name: 'Files in this import' });
  await expect(files.getByRole('row')).toHaveCount(4);
  await expect(files.getByRole('row', { name: /part-1-copy.pdf/ })).toContainText(
    'Already imported',
  );
  await page.getByRole('link', { name: 'Next: extraction' }).click();
  await expect(page).toHaveURL(/step=extract$/);
  await expect(
    page.getByRole('list', { name: 'Import steps' }).locator('[aria-current="step"]'),
  ).toHaveText('3Extract');
});

test('a dropped connection is retried, and the upload finishes', async ({ page }) => {
  await startAt(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/step=upload$/);

  let dropped = 0;
  await page.route('**/__s3/**', async (route) => {
    if (route.request().method() === 'PUT' && dropped === 0) {
      dropped += 1;
      return route.abort('connectionreset');
    }
    return route.fallback();
  });
  await page.getByLabel('Choose PDF or ZIP files').setInputFiles([roll('part-1.pdf', 'dropped')]);
  await page.getByRole('button', { name: 'Upload files (1)' }).click();
  const item = page.getByRole('list', { name: 'Files to upload' }).getByRole('listitem');
  await expect(item.getByText('Uploaded', { exact: true })).toBeVisible();
  await expect(item.getByText('Extracting')).toBeVisible();
  expect(dropped).toBe(1);
});

test('at Part level, exactly one PDF', async ({ page }) => {
  await startAt(page, '1 Demo Nagar');
  await expect(page.getByText('At Part level, upload exactly one PDF')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Importing into Part 1 Demo Nagar.')).toBeVisible();

  const input = page.getByLabel('Choose a PDF');
  await expect(input).not.toHaveAttribute('multiple');
  await input.setInputFiles([roll('part-1.pdf', 'part')]);
  await page.getByRole('button', { name: 'Upload files (1)' }).click();
  await expect(
    page.getByRole('list', { name: 'Files to upload' }).getByText('Uploaded', { exact: true }),
  ).toBeVisible();
  await input.setInputFiles([roll('part-1b.pdf', 'second')]);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'part-1b.pdf: a Part takes exactly one PDF',
  );
});

test('an unknown batch in the link says so', async ({ page }) => {
  await signInAsAdmin(page, '/imports?batch=batch-missing&step=upload');
  await expect(page.getByText("This import can't be found in your area.")).toBeVisible();
  await page.getByRole('link', { name: 'Start a new import' }).click();
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByLabel('Your area')).toBeVisible();
});

test('extraction progress: statuses, a rejection reason, a filter, and confirming the ready files', async ({
  page,
}) => {
  await startAt(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/step=upload$/);
  // The stand-in extracts by name: "other-ac" is rejected, "review" needs review.
  await page
    .getByLabel('Choose PDF or ZIP files')
    .setInputFiles([
      roll('part-1.pdf', 'ready'),
      roll('part-1-review.pdf', 'needs review'),
      roll('other-ac.pdf', 'outside'),
    ]);
  await page.getByRole('button', { name: 'Upload files (3)' }).click();
  await expect(
    page.getByRole('list', { name: 'Files to upload' }).getByText('Uploaded', { exact: true }),
  ).toHaveCount(3);
  await page.getByRole('link', { name: 'Next: extraction' }).click();

  const table = page.getByRole('table', { name: 'Every file of this import' });
  // The page asks again by itself until every file has finished.
  await expect(page.getByText('Every file has finished.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Files extracted: 3 of 3')).toBeVisible();
  await expect(table.getByRole('row', { name: /^part-1\.pdf/ })).toContainText(
    /1 Demo Nagar.*Ready.*30.*810.*93%.*Totals match/,
  );
  await expect(table.getByRole('row', { name: /part-1-review\.pdf/ })).toContainText(
    /Needs review.*Totals don't match/,
  );
  await expect(table.getByRole('row', { name: /other-ac\.pdf/ })).toContainText(
    /Rejected\s*Part belongs to AC 41, not AC 101/,
  );
  await expect(table.getByRole('link', { name: 'Review part-1-review.pdf' })).toHaveAttribute(
    'href',
    /step=review&file=/,
  );
  await expectAccessible(page);

  await page.getByLabel('Show').selectOption({ label: 'Ready (1)' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await page.getByLabel('Show').selectOption({ label: 'All files (3)' });

  await page.getByRole('button', { name: 'Confirm all ready files (1)' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Confirm the ready files?' });
  await expect(dialog).toContainText('Ready files: 1, with 810 voters.');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Confirm all ready files (1)' }).click();
  await expect(page.getByText('Files being confirmed: 1.')).toBeVisible();
  await expect(table.getByRole('row', { name: /^part-1\.pdf/ })).toContainText('Confirmed', {
    timeout: 15_000,
  });
  await expect(table.getByRole('row', { name: /part-1-review\.pdf/ })).toContainText(
    'Needs review',
  );
  await expect(page.getByRole('button', { name: 'Confirm all ready files (0)' })).toBeDisabled();
});
