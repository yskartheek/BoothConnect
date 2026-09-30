# #63: Mobile households list with search and status filter

**Issue:** https://github.com/yskartheek/BoothConnect/issues/63
**What changed:**

- **Households** lists the booth's households from the phone's own database,
  in house-number order (2, 12/4, 14, 15A). Each row shows:
  - the address;
  - the number of members and the last visit's outcome, or "Not visited";
  - an upload chip: **Uploaded**, **On phone** (a visit or change not yet
    uploaded) or **Choose value** (a detail someone else changed too). A
    household never visited, with nothing on the phone, has no chip.
- **Search** by address or by any member's name (as on the roll, or as
  corrected), in any case.
- **Filters:** All, Not visited, Visited and Follow-up, each with its count.
  Search and filter work together.
- **Add household:** a floating button on Android, **Add** in the header on
  iOS. It opens a "New household" page (the form comes in #115).
- Pull down to download the booth's latest data. Tap a row to open the
  household.
- Queued changes now record which household they belong to (database version
  2). Changes already queued on the phone are kept.
- All text is in English and Telugu.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-63-households-list
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. On the emulator with the API running (see the
   [#60 guide](60-mobile-sign-in.md)), sign in as `+919999900002` (Demo
   Volunteer A) and tap **Households**.
   **Expect:** the booth's households in house-number order, each with
   "_n_ members · Not visited" and no chip. The **All** chip's count matches
   "_N_ households" on home.
3. Type part of an address, then part of a member's name, in the search box.
   **Expect:** only matching households. Tap **✕** in the box: everyone is
   back.
4. Tap **Visited**.
   **Expect:** "No households match" (nothing has been visited yet), with
   **Clear search and filter**. Tap it: back to **All** and every household.
5. Pull the list down.
   **Expect:** the list refreshes (the spinner goes away).
6. Tap a household, then back. Tap **Add household**, then back.
   **Expect:** the household page, then the "New household" page; back
   returns to the list with the search and filter kept.
7. Optional, on an iPhone simulator: **Add** is in the header, and there's
   no floating button.
8. Optional: switch the phone's language to Telugu.
   **Expect:** the search hint, filters and "_n_ సభ్యులు" are in Telugu.

## Pass criteria

- Steps 1–6 give the expected results.

## Known issues and notes

- Rows show **On phone**, **Follow-up** and **Choose value** once recording
  visits and changes on the phone is built (#65, #66). The tests cover them
  with synthetic data.
- Installing this build over #59–#62 keeps the phone's data: the database
  moves to version 2 on first launch.
