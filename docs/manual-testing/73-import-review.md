# #73: Roll import steps 3–4, review, correct and confirm

**Issue:** https://github.com/yskartheek/BoothConnect/issues/73
**What changed:**

- **Review** (from the extraction progress list, or
  `/imports?batch=…&step=review&file=…`) opens one file:
  - **What confirming does:** the part and the polling stations (including
    auxiliary ones) that will be created or kept, whether it is a new
    revision, and the cover page as read (roll, revision, dates, AC, part…).
  - **Totals check:** printed, as read, now and the difference, for men,
    women, third gender and the total.
  - **Rows:** filtered by status or "only rows with low-confidence fields",
    50 at a time. Fields read with low confidence are highlighted, corrected
    ones are in italics, and each row's messages are shown.
  - **Correct:** the roll's page image next to the row's fields. Each field
    shows the value as read. Only changed fields are saved; the value as read
    stays on record, with who corrected it and when. **Reject row** (with an
    optional reason) and **Take back the rejection**.
  - **Download rejections CSV.**
- **Confirm this file:**
  - The dialog states the voters and households that will be committed, and
    the part.
  - When the totals don't match, you have to tick that you've checked why.
  - While it commits, the page follows it ("Committing the voters…"), then
    says "Committed: N voters are live." and links to the part's analytics.
- API: the file preview has `willCommit` (voters and households, as confirm
  would commit them; empty while rows still have errors). The admin web's
  `/api` now passes on `Cache-Control`, so voter page images stay
  `private, no-store`.

Test files only: the synthetic roll `apps/roll-parser/tests/fixtures/small.pdf`
(fake data). Never upload a real roll.

## Steps

1. Prepare as in the [#72 guide](72-import-progress.md), steps 1–3: the
   worker running and synthetic AC 40. After the #72 guide, part 408 is
   already confirmed once, so make another copy of the roll (a new checksum;
   the same file again would be "Already imported"):
   ```powershell
   Copy-Item apps\roll-parser\tests\fixtures\small.pdf $env:TEMP\rolls\part-408-rev2.pdf
   Add-Content $env:TEMP\rolls\part-408-rev2.pdf "`n%C"
   ```
2. **Roll imports** → AC 40 → **Continue**, upload `part-408-rev2.pdf`, then
   **Next: extraction**. Wait for **Ready**, then click **Review**.
   **Expect:**
   - "4 Review" is current;
   - "Part 408 RUME NAGAR will be updated.", its polling stations 408 and
     408A (**Auxiliary**) "already known", and "A new revision of the part:
     the previous one is kept.";
   - the cover page: roll, revision "Special Intensive Revision 2026", dates;
   - the totals check "Totals match": men 19, women 20, third gender 1,
     total 40;
   - "Rows (42)" (40 voters, plus entries marked deleted).
3. Tick **Only rows with low-confidence fields**.
   **Expect:** only those rows, with the low-confidence fields highlighted.
   Untick it.
4. Click **Correct** on any row.
   **Expect:** the page image of the roll beside the fields, each field with
   "Read as: …". **Save correction** stays disabled until you change
   something.
5. Change that row's **Name** (add a letter) and **Save correction**.
   **Expect:**
   - "Correction saved.";
   - "Corrected by Demo Admin on …";
   - the name in the table in italics.
6. On another row, **Reject row** with the reason "Test".
   **Expect:** the row is **Rejected**, and the totals check now shows ✗ (one
   voter fewer than printed). Click **Take back the rejection** on it.
   **Expect:** ✓ again.
7. Click **Download rejections CSV**.
   **Expect:** a CSV file downloads.
8. Click **Confirm this file**.
   **Expect:** "Voters to commit: 40, in 33 households, to Part 408 RUME
   NAGAR." Confirm.
   **Expect:**
   - "5 Confirm" is current;
   - "Committing the voters…", then "Committed: 40 voters are live.";
   - a link "See the analytics of Part 408 RUME NAGAR" (that page is #74).
     Copy the part's id from the link's address (`?node=<id>`).
9. The analytics changed with the commit. With the `SignIn` helper from the
   [#36 guide](36-geographies.md):
   ```powershell
   $ad = SignIn "+919999900001"
   $m = (Invoke-RestMethod "$api/analytics/nodes/<part id>/summary" -Headers $ad).metrics
   $m.'electors.total'; $m.'households.total'
   ```
   **Expect:** 40 and 33, the numbers the dialog stated. Small groups show as
   "suppressed" (the cohort rule).
10. The audit log (`GET /v1/audit-events?action=import.*`) has
    `import.row.correct` (each correction, rejection and restore),
    `import.file.rejections_export`, `import.file.confirm` and
    `import.file.committed`, with ids and counts only.
11. Run the tests:
    ```powershell
    pnpm --filter admin-web test
    pnpm --filter admin-web test:e2e
    pnpm --filter api test:int -- test/import-review.int-spec.ts test/import-confirm.int-spec.ts
    ```
    **Expect:** all pass.

## Pass criteria

- Steps 2–11 give the expected results.

## Known issues and notes

- The issue's end-to-end test ends with "voters are visible and the analytics
  update". The portal's voter and analytics pages are #75 and #74, so the
  browser test stops at "Committed" and the analytics link. The API check in
  step 9 covers the rest.
- The page image shows the whole page; the row's box isn't outlined (the
  extraction doesn't keep box coordinates). The caption says which box it is.
