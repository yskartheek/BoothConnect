# #103: Admin web, geography master data page

**Issue:** https://github.com/yskartheek/BoothConnect/issues/103
**What changed:**

- **Geography** in the admin portal has two parts.
  - **Upload master data:** download the template CSV, check a filled file
    (each row's result, nothing saved), then save it.
  - **Current hierarchy:** the States, PCs and ACs with search, and **Edit**
    to change a name or reservation. Parts and polling stations are shown
    read-only, marked "From roll imports".
- API changes that support the page:
  - geography lists now include each node's reservation;
  - an admin of a State now sees every State, PC and AC of the program,
    including States they have just added.

Test data only: use the synthetic template.

## Steps

1. Start the API and the admin web as in the [#70 guide](70-admin-sign-in.md)
   (steps 1–4). Before signing in, make the seed admin a State admin so they
   can add States:
   ```powershell
   pnpm --filter api build
   pnpm --filter api admin:grant --phone +919999900001 --name "Demo Admin" --node S99
   ```
2. Sign in as `+919999900001` and open **Geography**.
   **Expect:** "Current hierarchy" shows State S99 → PC 1 (GEN) → AC 101
   (GENERAL).
3. Click **Download the template CSV**.
   **Expect:** `geography-master.csv` downloads.
4. Choose that file under **CSV file** and click **Check file**.
   **Expect:** "6 to add, 0 to update, 0 unchanged, 0 with errors", with a
   row for each line. Nothing appears in the tree yet.
5. Click **Save 6 changes**.
   **Expect:** "Saved: 6 added, 0 updated." The tree now shows State S98
   "Sample State" with its PCs and ACs.
6. Check the same file again.
   **Expect:** "0 to add, 0 to update, 6 unchanged, 0 with errors" and
   "Everything in this file is already saved." There is no save button.
7. Make a file with a mistake: copy the template and change the last line's
   `parent_code` to `99`. Check it.
   **Expect:** that row shows **Error** with "Unknown PC 99", the table shows
   only rows with errors, "Nothing has been saved" is shown, and there's no
   save button.
8. In the tree, type `river` in **Search by code or name**.
   **Expect:** only S98 → PC 1 → AC 12 "Riverside…" remain. Clear the search.
9. Open AC 101 (the ▸ button), then Part 1.
   **Expect:** Part 1 and its stations 1 and 1A (1A marked "Auxiliary"), each
   marked "From roll imports", with no **Edit** button.
10. Click **Edit** on AC 101, change **Reservation** to `SC`, and save.
    **Expect:** AC 101 shows `SC`. In **Audit and security**, or with
    `GET /v1/audit-events?action=geography.*`, the last `geography.update`
    lists only `["reservation"]`.
11. Run the tests:
    ```powershell
    pnpm --filter admin-web test
    pnpm --filter admin-web test:e2e
    pnpm --filter api test:int -- test/geographies.int-spec.ts
    ```
    **Expect:** all pass: 68 component tests, 19 browser tests (the browser
    tests use a stand-in API) and 10 API tests.

## Pass criteria

- Steps 2–11 give the expected results.

## Known issues and notes

- The issue's acceptance test says "the AC appears in the roll-import level
  dropdown". That dropdown is #71 and isn't built yet, so the browser test
  checks that the new ACs appear in the tree instead.
- Search covers States, PCs and ACs. Parts and stations aren't searched.
