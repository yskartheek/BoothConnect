# #75: Admin web, voter record view

**Issue:** https://github.com/yskartheek/BoothConnect/issues/75
**What changed:**

- **Voters and households** in the admin portal:
  - **Find a voter** by address, house number, member name or EPIC. A
    household opens to its members.
  - A member opens their record (`/voters?voter=<id>`).
- **The record:**
  - EPIC, section and serial, the roll's relation, relative and house number,
    and how many earlier records (older rolls) there are.
  - **One row per field** with two columns: **Official (from the roll)** and
    **Current**. Fields the roll doesn't print say "Not on the roll".
  - Each current value says who set it, how (Roll, Volunteer, Admin, Voter)
    and when. Values copied from an older roll say so.
  - **History (N)** expands a field's earlier values, newest first.
  - **Open conflicts** (two offline edits that collided) are flagged at the
    top and on the row, with both values; volunteers resolve them.
  - **Correct** (admins): a new value based on the current one. It is saved
    as an admin correction, and the earlier value joins the history. The
    API's refusals are shown as they are. Consent-gated fields (caste) aren't
    corrected here.
  - Caste/community appears only for roles allowed to see it (the API
    decides).
  - The visits that met the voter.
- **API:**
  - opening a record is audited (`voter.view`, ids only);
  - an admin's edit is stored as `admin_corrected` (it was stored as
    `volunteer_collected`).

Test data only: the seeded demo data.

## Steps

1. Start the API and the admin web as in the [#70 guide](70-admin-sign-in.md)
   (steps 1–4), on a freshly seeded database. Sign in as `+919999900001` and
   open **Voters and households**.
2. Search for `1` and click **Find**.
   **Expect:** households with "1" in the house number or address. Open one.
   **Expect:** its members with age, gender and EPIC.
3. Open a member.
   **Expect:**
   - their record: the roll's details, then **Details** with the Official
     and Current columns;
   - Name, Age and Gender "As on the roll" (unless changed);
   - Mobile number, Occupation and Additional information "Not on the roll";
   - Caste/community marked **Restricted**, with no **Correct** button.
4. For a member with an occupation entered in the field (the seed gives one
   to the first voter of booth 1; search for its EPIC): the Occupation row
   shows the value and "Volunteer · Demo Volunteer A · date".
5. **Correct** the occupation to `Test Teacher` and **Save**.
   **Expect:**
   - "Test Teacher · Admin · Demo Admin · today";
   - **History (1)**, which expands to the earlier value.
6. **Correct** Age to `12` and **Save**.
   **Expect:** the API's refusal (age must be between 18 and 120); nothing
   changes.
7. The audit log (`GET /v1/audit-events?resourceId=<voter id>`) has
   `voter.view` (`{"history":true}`) for each opening and `voter.update`
   with the field key and outcome. No values or names.
8. A conflict: two edits that collided (see the
   [#113 guide](113-member-edits-conflicts.md)),
   or with the API, two `PATCH /v1/voters/<id>` of `mobile_number` with the
   same `baseVersion`.
   **Expect:** "Open conflicts: Mobile number." at the top; the row shows
   "Conflict: two values" and both values, with no **Correct**.
9. Run the tests:
   ```powershell
   pnpm --filter admin-web test
   pnpm --filter admin-web test:e2e
   pnpm --filter api test:int -- test/voter-detail.int-spec.ts test/member-edits-conflicts.int-spec.ts
   ```
   **Expect:** all pass.

## Pass criteria

- Steps 2–9 give the expected results.

## Known issues and notes

- The search goes through households (as the phone app does); there's no
  voter list of its own yet.
- Conflicts are resolved by volunteers in the app (or
  `POST /v1/conflicts/:id/resolve`); the page only shows them.
