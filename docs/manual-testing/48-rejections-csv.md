# #48: Roll imports, downloading the rows to fix as a CSV

**Issue:** https://github.com/yskartheek/BoothConnect/issues/48
**What changed:**

- `GET /v1/imports/files/:id/rejections.csv` downloads the rows of one
  imported file that were **rejected** or have a **warning**, in roll order.
  Each row has its page, section and serial, the values read from the
  roll, any corrections, and the problems found.
- **Safe to open in Excel.** Some values could be run as formulas: anything
  starting with `=`, `+`, `-`, `@`, a tab or a carriage return. These get a
  `'` in front, so the spreadsheet shows them as text. This matters because
  the values come from reading scanned PDFs.
- Opens with Telugu names intact (UTF-8 with a byte-order mark).
- Admins only, inside their own area (**404** outside it); volunteers get
  **403**. Each download is recorded in the audit log (row count only).
- **Use test files only. Never upload real electoral rolls.**

## Steps

1. Prepare as for #46 (branch `claude/issue-48-rejections-csv`,
   `pnpm infra:up`, `db:deploy`, `db:seed`, `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`). Paste the `SignIn` helper from the #36 guide into a
   second PowerShell window.
2. Upload a small test PDF as in steps 2–4 of the #44 guide (keep `$ad` and
   `$done`).
3. Download its CSV:
   ```powershell
   $f = $done.files[0].id
   Invoke-WebRequest "$api/imports/files/$f/rejections.csv" -Headers $ad -OutFile rejections.csv
   Get-Content rejections.csv
   ```
   **Expect:** one line of column names only:
   `page,box,section,serial,status,epic,name,...,corrections,messages`.
   The test PDF has no voter rows. Open `rejections.csv` in Excel:
   one row of headers.
4. As **volunteer A**:
   ```powershell
   $v = SignIn "+919999900002"
   Invoke-WebRequest "$api/imports/files/$f/rejections.csv" -Headers $v
   ```
   **Expect:** `403 Forbidden`.
5. Run the tests (MinIO must be running):
   ```powershell
   pnpm --filter api test; pnpm --filter api test:int
   ```
   **Expect:** all pass, including "CSV safety" and "rejections.csv". They
   export made-up rows containing `=HYPERLINK(...)`, `+91...`, `-12`,
   `@SUM(A1)` and a tab, and check that each comes out with a `'` in front.
   They also check that commas and quotes survive, that a file of 1,203
   rows streams completely, and that the export is audited.

## Pass criteria

- Steps 3–5 give the expected results.

## Known issues and notes

- As in #46, real rows can't be produced against the development seed
  yet, so the CSV of a real file can only be seen once master data
  (#100) or the admin web exists. The tests cover the contents.
