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
    /1 Demo Nagar.*Ready.*3.*3.*93%.*Totals match/,
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
  await expect(dialog).toContainText('Ready files: 1, with 3 voters.');
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

test('review a file: counts, correct a row beside its page, confirm, and see it committed', async ({
  page,
}) => {
  await startAt(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/step=upload$/);
  // The stand-in "extracts" three voters; this file needs review.
  await page
    .getByLabel('Choose PDF or ZIP files')
    .setInputFiles([roll('part-1-review.pdf', 'review')]);
  await page.getByRole('button', { name: 'Upload files (1)' }).click();
  await expect(
    page.getByRole('list', { name: 'Files to upload' }).getByText('Uploaded', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Next: extraction' }).click();
  await expect(page.getByText('Every file has finished.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Review part-1-review.pdf' }).click();
  await expect(page).toHaveURL(/step=review&file=/);
  await expect(
    page.getByRole('list', { name: 'Import steps' }).locator('[aria-current="step"]'),
  ).toHaveText('4Review');

  // What confirming does, and the counts: printed 2 men, 1 woman; read 1 and 1.
  await expect(page.getByText('Part 1 Demo Nagar will be updated.')).toBeVisible();
  const totals = page.getByRole('table', { name: /Totals check/ });
  await expect(totals).toContainText("Totals don't match");
  await expect(totals.getByRole('row', { name: /Men/ })).toHaveText(/Men\s*2\s*2\s*1\s*-1/);
  await expect(page.getByRole('heading', { name: 'Rows (3)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm this file' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Download rejections CSV' })).toHaveAttribute(
    'href',
    /\/api\/v1\/imports\/files\/.+\/rejections\.csv$/,
  );
  await expectAccessible(page);

  // Only the low-confidence row.
  await page.getByLabel('Only rows with low-confidence fields').check();
  await expect(page.getByRole('heading', { name: 'Rows (1)' })).toBeVisible();
  await page.getByLabel('Only rows with low-confidence fields').uncheck();

  // Correct row 3's missing gender, beside its page image.
  await page.getByRole('button', { name: 'Correct row 1/3' }).click();
  const panel = page.getByRole('region', { name: 'Row 1/3, page 3' });
  const image = panel.getByRole('img', { name: 'Page 3 of the roll' });
  await expect(image).toBeVisible();
  // Visible isn't loaded: wait for the image itself.
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)))
    .toBeGreaterThan(0);
  await panel.getByLabel('Gender').selectOption({ label: 'Male' });
  await expectAccessible(page);
  await panel.getByRole('button', { name: 'Save correction' }).click();
  await expect(panel.getByRole('status')).toContainText('Correction saved.');
  await expect(panel.getByText(/Corrected by Test Admin/)).toBeVisible();
  await expect(totals).toContainText('Totals match');
  await expect(page.getByRole('heading', { name: /Review part-1-review\.pdf/ })).toContainText(
    'Ready',
  );

  // Confirm: the voters and households are stated.
  await page.getByRole('button', { name: 'Confirm this file' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Confirm this file?' });
  await expect(dialog).toContainText('Voters to commit: 3, in 2 households, to Part 1 Demo Nagar.');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Confirm this file' }).click();
  await expect(page).toHaveURL(/step=confirm&file=/);
  await expect(
    page.getByRole('list', { name: 'Import steps' }).locator('[aria-current="step"]'),
  ).toHaveText('5Confirm');
  await expect(page.getByText('Committed: 3 voters are live.')).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('link', { name: 'See the analytics of Part 1 Demo Nagar' }),
  ).toHaveAttribute('href', /\/analytics\?node=/);
  // A confirmed file can't be corrected any more.
  await page.getByRole('button', { name: 'Correct row 1/1' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Row 1/1, page 3' })
      .getByRole('button', { name: 'Save correction' }),
  ).toHaveCount(0);
});
