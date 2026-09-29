# #46: Roll imports, batch progress, file preview, page images and row corrections

**Issue:** https://github.com/yskartheek/BoothConnect/issues/46
**What changed:**

- **Batch progress** (`GET /v1/imports/batches/:id`): one entry per file,
  with:
  - its status and, for a rejected or failed file, the reason;
  - the part it belongs to, or the part that will be created;
  - page count and quality score;
  - rows read, by status, and how many voters they would become.
- **File preview** (`GET /v1/imports/files/:id/preview`):
  - the cover page as read, the polling stations and any problems found;
  - the **totals check**: the totals printed on the roll next to the voters
    actually counted, before and after corrections;
  - the rows, a page at a time. Filters show only rows with warnings, or
    only fields read with low confidence.
- **Page images** (`GET /v1/imports/files/:id/pages/:n`): the picture of one
  voter page, so a row can be checked against the roll. The cover, the
  maps/photos page and the summary page are never shown. Images are never
  cached.
- **Correcting a row** (`PATCH /v1/imports/files/:id/rows/:rowId`):
  - fix a field (name, age, gender, EPIC…) or reject the row;
  - the value that was read stays stored next to the correction, with who
    made it and when;
  - the checks and the totals check run again. A file whose totals now
    match, and has no errors left, becomes `ready`;
  - every change is recorded in the audit log (field names only, never the
    values).
- Admins only, inside their own area. Volunteers get **403**.
- **Use test files only. Never upload real electoral rolls.**

## Steps

1. Prepare as for #45 (branch `claude/issue-46-import-review`,
   `pnpm infra:up`, `db:deploy`, `db:seed`, `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`). Paste the `SignIn` helper from the #36 guide into a
   second PowerShell window. The roll-parser is optional here.
2. Upload a small test PDF as in steps 2–4 of the #44 guide. Keep `$ad`,
   `$batch` and `$done` from those steps.
3. See the batch's progress:

   ```powershell
   $b = Invoke-RestMethod "$api/imports/batches/$($batch.id)" -Headers $ad
   $b | Select-Object status, fileCount, statusCounts
   $b.files | Format-Table originalName, status, pageCount, rowCount, voterCount, qualityScore
   ```

   **Expect:** one file:
   - with the roll-parser running, after a few seconds its status is
     `rejected`, and `$b.files[0].error.code` is `not_a_roll`;
   - without it, the status stays `extracting`.

   `rowCount` and `voterCount` are 0 (the test PDF has no voter pages).

4. Preview the file:
   ```powershell
   $f = $done.files[0].id
   $p = Invoke-RestMethod "$api/imports/files/$f/preview" -Headers $ad
   $p.totals; $p.rows
   ```
   **Expect:** `matches` is `False`; `rows.items` is empty and `total` is 0.
5. Try to reject a row of that file (any ID will do):
   ```powershell
   Invoke-RestMethod "$api/imports/files/$f/rows/$([guid]::NewGuid())" -Method Patch -Headers $ad -Body '{"rejected":true}' -ContentType "application/json"
   ```
   **Expect:** `409 Conflict`: only files that are `ready` or `needs_review`
   can be reviewed.
6. Ask for a page image: `Invoke-WebRequest "$api/imports/files/$f/pages/3" -Headers $ad`.
   **Expect:** `404` (this file has no voter pages).
7. As **volunteer A**, repeat step 3 or step 6:
   ```powershell
   $v = SignIn "+919999900002"
   Invoke-RestMethod "$api/imports/batches/$($batch.id)" -Headers $v
   ```
   **Expect:** `403 Forbidden`.
8. Run the tests (MinIO must be running):
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "import review". They use a made-up
   file of four rows and check:
   - the counts and filters;
   - that a correction is stored next to the value read, and is audited;
   - that fixing an unread gender makes the totals match, so the file
     becomes `ready`;
   - that rejecting a row takes it out of the counts;
   - that page images are only voter pages, and volunteers can't read them.

## Pass criteria

- Steps 3–8 give the expected results.

## Known issues and notes

- **Reviewing real rows by hand:**
  - The synthetic rolls from #96 are printed for State S29, AC 40, and the
    development seed only has S99 / AC 101, so an upload of one is rejected
    as outside the batch's area.
  - Reviewing rows by hand becomes possible once the master data can be
    added (the geography screens), or with the admin web's review screen.
    Until then the tests cover it.
- Confirming a file (turning reviewed rows into households and voters) is
  #47.
- After any correction, the file's status follows the totals check and
  remaining errors. The roll-parser's own "needs review" flag (for a poor
  scan) no longer holds a file back once someone has reviewed it.
