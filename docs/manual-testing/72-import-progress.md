# #72: Roll import step 2, batch extraction progress

**Issue:** https://github.com/yskartheek/BoothConnect/issues/72
**What changed:**

- The **Extract** step of a roll import lists every file of the batch:
  - the part (from the header; **New** when confirming will create it);
  - the status: Extracting, Needs review, Ready, Confirming, Confirmed,
    Rejected, Already imported or Failed;
  - pages, voters, quality score, and the totals check (✓ when the voters
    match the totals printed in the roll).
- Rejected and failed files show why (e.g. "This roll is for S29 AC 40 part
  408, which is not under the batch's …").
- The page asks again every 3 seconds while any file is extracting or
  confirming, with overall progress ("Files extracted: 3 of 5"). It stops
  once everything has finished.
- **Show** filters by status. Long batches show 50 files at a time.
- **Review** opens a file that needs review or is ready (the review screen
  is #73).
- **Confirm all ready files (N)** counts only Ready files, and asks first:
  "Ready files: N, with V voters…".
- API: each file in `GET /v1/imports/batches/:id` now has `totalsMatch`
  (true, false, or null when the printed totals couldn't be read).

Test files only: the synthetic roll `apps/roll-parser/tests/fixtures/small.pdf`
(fake data). Never upload a real roll.

## Steps

1. Start everything as in the [#71 guide](71-import-upload.md) step 1, on a
   freshly seeded database. Also start the roll-parser worker in a second
   window (see `apps/roll-parser/README.md`). It needs the same settings as
   the API:
   ```powershell
   pnpm --filter roll-parser sync
   Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
     $name, $value = $_ -split '=', 2; Set-Item "env:$name" $value }
   pnpm --filter roll-parser worker
   ```
2. The synthetic roll is for S29 / AC 40 / part 408. Add that AC and make the
   seed admin its admin. In a third window, from the repository root:
   ```powershell
   pnpm --filter api build
   pnpm --filter api admin:grant --phone +919999900001 --name "Demo Admin" --node S99
   ```
   Sign in to the portal as `+919999900001`. Open **Geography** and check a
   file with these lines, then save it:
   ```text
   level,code,name,reservation,parent_code,state_code
   state,S29,Synthetic State 29,,,
   pc,6,Synthetic PC 6,GEN,S29,
   ac,40,Synthetic AC 40,GEN,6,S29
   ```
   Then:
   ```powershell
   pnpm --filter api admin:grant --phone +919999900001 --name "Demo Admin" --node S29/6/40
   ```
   Sign out and in again.
3. Make two copies of the synthetic roll with different checksums:
   ```powershell
   $src = "apps\roll-parser\tests\fixtures\small.pdf"
   mkdir $env:TEMP\rolls -Force | Out-Null
   Copy-Item $src $env:TEMP\rolls\ac40-roll.pdf
   Add-Content $env:TEMP\rolls\ac40-roll.pdf "`n%A"
   Copy-Item $src $env:TEMP\rolls\part-408.pdf
   Add-Content $env:TEMP\rolls\part-408.pdf "`n%B"
   Copy-Item $env:TEMP\rolls\part-408.pdf $env:TEMP\rolls\part-408-copy.pdf
   ```
4. **Roll imports**: choose **AC 101**, **Continue**, upload `ac40-roll.pdf`,
   then **Next: extraction**.
   **Expect:** "Extracting" and "Still working. This page updates by
   itself.". After a few seconds, without reloading:
   - **Rejected**, with "This roll is for S29 AC 40 part 408, which is not
     under the batch's …";
   - "Every file has finished.";
   - **Confirm all ready files (0)** can't be clicked.
5. **Start a new import**, choose **AC 40 Synthetic AC 40**, and upload
   `part-408.pdf` and `part-408-copy.pdf`. Then **Next: extraction**.
   **Expect:**
   - the copy is **Already imported**;
   - `part-408.pdf` becomes **Ready**, with part "408 RUME NAGAR" and
     **New**, 5 pages, 40 voters, a quality of about 83%, and ✓ under Totals;
   - "Files extracted: 2 of 2";
   - a **Review** link on the Ready file (the review screen comes in #73).
6. **Show** → "Ready (1)".
   **Expect:** only `part-408.pdf`. Set it back to "All files".
7. Click **Confirm all ready files (1)**.
   **Expect:** "Ready files: 1, with 40 voters…". Click the same button in
   the dialog.
   **Expect:** "Files being confirmed: 1.", then **Confirmed** without
   reloading. The **New** badge goes, because the part now exists.
8. Run the tests:
   ```powershell
   pnpm --filter admin-web test
   pnpm --filter admin-web test:e2e
   pnpm --filter api test:int -- test/import-review.int-spec.ts
   ```
   **Expect:** all pass: 112 component tests, 29 browser tests (with a
   stand-in API that "extracts" by file name) and 14 API tests.

## Pass criteria

- Steps 4–8 give the expected results.

## Known issues and notes

- The quality score and page count of a rejected file are shown, but not its
  voters: its rows aren't kept.
- **Review** leads to the review step, which is built in #73.
- To start again, seed a fresh database.
