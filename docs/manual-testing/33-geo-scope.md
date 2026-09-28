# #33: Geographic scope: users only see their own booths

**Issue:** https://github.com/yskartheek/BoothConnect/issues/33
**What changed:**

- On every signed-in request, the API works out **which polling stations
  (booths) the user may see**, from their active role assignments:
  - an assignment on a **booth** covers just that booth;
  - on a **part**, the part's main and auxiliary booths;
  - on an **AC** (or PC, or state), every booth below it.
- From now on, every endpoint that returns households, voters or visits must
  filter by that list. A shared helper does this, so a volunteer can never
  see another booth's records.
- Asking for a record outside your booths gives **404 Not found**, exactly
  as if it didn't exist, so nobody can check whether an ID exists.
- Endpoints can be limited to roles (for example admins and campaign
  managers). Other users get **403 Forbidden**.

There are **no endpoints for households or voters yet** (they come in Epic 4,
#36–#39), so you can't see this in a browser or with curl yet. The automated
tests check it with a test-only endpoint over the seeded data.

## Steps

1. Check out the branch and start the services:
   ```powershell
   git checkout claude/issue-33-geo-scope
   pnpm install --frozen-lockfile
   pnpm infra:up
   ```
2. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "GeoScopeGuard and scoped queries":
   - volunteer A's scope is exactly station 1; the admin's is stations 1,
     1A and 2; a part-level assignment covers 1 and 1A;
   - expired and future assignments are ignored; a user with no assignments
     sees nothing;
   - volunteer A lists only station 1's households; the admin sees all 40;
   - volunteer A asking for a station-2 household gets 404, the same as for a
     made-up ID, while volunteer B (whose booth it is) gets it;
   - an admins-only endpoint gives volunteers 403.
3. Optional: see your own booths with `GET /v1/me` (guide #32). Its
   assignments are what the scope is built from.

## Pass criteria

- Step 2 passes.

## Known issues and notes

- **You'll be able to try this by hand with #36–#39** (households and voters
  API): volunteer A won't see volunteer B's households.
- Roles are checked across all of a user's active assignments: a user who is
  a campaign manager anywhere passes a campaign-manager-only check. What they
  see is still limited to their booths.
