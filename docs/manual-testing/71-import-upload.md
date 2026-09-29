# #71: Roll import step 1, choose the level and upload

**Issue:** https://github.com/yskartheek/BoothConnect/issues/71
**What changed:**

- **Roll imports** in the admin portal now has the first two steps of the
  import. A stepper shows all five: Choose level → Upload → Extract → Review →
  Confirm.
  - **Choose level:** cascading dropdowns from the admin's own area down to a
    Part. You can stop at any level. Long lists (an AC's parts) have a search
    box, and the chosen place is shown as a breadcrumb from the State.
    **Continue** opens a batch, and its ID goes in the address
    (`/imports?batch=…&step=upload`), so a reload comes back to it.
  - **Upload:** drop files, or choose them.
    - At Part level: exactly one PDF.
    - At AC, PC or State level: any number of PDFs, or ZIPs of PDFs.
    - Wrong types, empty files, files over 100 MB (PDF) or 2 GB (ZIP), and
      files already in the list are refused, with the reason.
    - Files go straight to storage in parts, with a progress bar each.
    - A dropped connection is retried automatically (after 1, 2, 4 and 8
      seconds, once back online). If it still fails, **Retry** continues
      from the parts already sent.
    - A file that was already imported (same content) shows **Already
      imported**, not an error.
- The Extract, Review and Confirm steps are the next issues (#72, #73); for
  now they say "This page is being built."

Test files only: make synthetic PDFs as below. Never upload a real roll.

## Steps

1. Start the API and the admin web as in the [#70 guide](70-admin-sign-in.md)
   (steps 1–4). MinIO must be running (`pnpm infra:up`). Sign in as
   `+919999900001` and open **Roll imports**.
   **Expect:** the stepper with "1 Choose level" current.
2. Make three synthetic files in a scratch folder:
   ```powershell
   mkdir $env:TEMP\rolls -Force | Out-Null; cd $env:TEMP\rolls
   "%PDF-1.4`n% synthetic test roll A`n%%EOF" | Set-Content -NoNewline part-1.pdf
   "%PDF-1.4`n% synthetic test roll B`n%%EOF" | Set-Content -NoNewline part-2.pdf
   Copy-Item part-1.pdf copy-of-part-1.pdf
   "not a pdf" | Set-Content notes.txt
   ```
3. Under **Your area**, choose AC 101.
   **Expect:**
   - a **Part** dropdown with Part 1 and Part 2;
   - the breadcrumb "State S99 Demo State › PC 1 … › AC 101 …";
   - the hint "Upload one PDF per part, as many as you need, or ZIP files of
     PDFs".

   Click **Continue**.
   **Expect:**
   - the address ends in `?batch=<id>&step=upload`;
   - "Importing into AC 101 Demo Assembly Constituency.";
   - "2 Upload" is current.

4. Choose (or drag in) `part-1.pdf`, `part-2.pdf` and `notes.txt`.
   **Expect:** "notes.txt: only PDF and ZIP files can be uploaded". The two
   PDFs are listed as Waiting.
5. Click **Upload files (2)**.
   **Expect:** each file shows a progress bar, then "Uploaded" and
   "Extracting". Without the roll-parser worker running they stay
   Extracting, which is fine here.
6. Choose `copy-of-part-1.pdf` and upload it.
   **Expect:** "Already imported", with no error.
7. Reload the page.
   **Expect:** the same batch, with a **Files in this import** table listing
   the three files and their status.
8. A dropped connection. In Chrome or Edge, open DevTools → **More tools** →
   **Network request blocking**. Add `localhost:9000` (the storage) and tick
   it. Make `part-3.pdf` as in step 2 (with other text), choose it, and click
   **Upload files (1)**.
   **Expect:** "Connection lost; trying again". Within about 15 seconds,
   untick the blocking.
   **Expect:** "Uploaded" and "Extracting". If you leave it blocked longer,
   you get "The upload stopped…" and a **Retry** button. Retry after
   unblocking continues where it stopped.
9. Click **Start a new import**, choose AC 101 → Part 2, and **Continue**.
   **Expect:**
   - the hint "At Part level, upload exactly one PDF";
   - the picker takes one file only (**Choose a PDF**).

   Upload `part-2.pdf`, then choose another PDF.
   **Expect:** "a Part takes exactly one PDF".

10. The audit log (`GET /v1/audit-events?action=import.*`, or **Audit and
    security**) has `import.batch.create`, `import.upload.start` and
    `import.upload.complete`, with ids, kinds, sizes and counts only.
11. Run the tests:
    ```powershell
    pnpm --filter admin-web test
    pnpm --filter admin-web test:e2e
    ```
    **Expect:** all pass: 105 component tests and 28 browser tests (the
    browser tests use a stand-in API and storage).

## Pass criteria

- Steps 1–11 give the expected results.

## Known issues and notes

- Resuming works within the page. After closing or reloading the page, a
  half-finished file has to be chosen and uploaded again. The browser
  doesn't keep the file, and the upload links can't be renewed yet.
- The size limits in the page are the API's defaults. The API checks the
  limits it is configured with and says so if a file is too large.
- In production, the imports bucket's CORS rules must allow `PUT` from the
  portal's address and expose the `ETag` header (see `apps/admin-web`
  README). Local MinIO allows it already.
- Extract, Review and Confirm come in #72 and #73.
