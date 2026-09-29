# #49: Analytics API: area summary, children table and revisions

**Issue:** https://github.com/yskartheek/BoothConnect/issues/49
**What changed:**

- Three read-only endpoints, for any area (State, PC, AC, part or polling
  station) inside the caller's own area:
  - **Summary**: voters by gender and age band, gender ratio, median age,
    households, changes since the previous roll, data quality and field
    work, each with a one-line definition and the time it was computed.
  - **Children table**: one row per child area (e.g. every part of an
    AC), with the parent's total and the average per child. It can be
    sorted by any figure.
  - **Revisions**: a part's roll revisions, with voters added and removed.
- **Privacy:**
  - Any figure about fewer than **10** people shows as `"suppressed"`.
  - So does any figure that would let a hidden one be worked out by
    subtraction, whether within a breakdown (e.g. men = total − women) or
    across areas (a hidden part = AC total − the other parts).
- **Not collected versus zero:** `null` means not collected (e.g. no
  visits yet, no earlier revision), and `0` is a real zero.
- Admins and campaign managers only. Volunteers get **403**, and areas
  outside your own give **404**.

## Steps

1. Prepare as usual (branch `claude/issue-49-analytics-api`,
   `pnpm infra:up`, `db:deploy`, `db:seed`, `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`). Paste the `SignIn` helper from the #36 guide into a
   second PowerShell window. Wait a few seconds after start-up: the
   numbers are built automatically (#102).
2. As the **admin**, get your AC's summary:
   ```powershell
   $ad = SignIn "+919999900001"
   $ac = (Invoke-RestMethod "$api/me" -Headers $ad).assignments[0].node.id
   $s = Invoke-RestMethod "$api/analytics/nodes/$ac/summary" -Headers $ad
   $s.metrics | Format-List electors.total, households.total, genderRatio, medianAge, revisions.additions
   ```
   **Expect:**
   - `electors.total` is around 120;
   - `households.total` is around 40;
   - `revisions.additions` is empty (null): the seed has only one
     revision;
   - `genderRatio` may be `suppressed`. A few voters have no recorded
     gender, which is too small a group to show. So another gender count
     is hidden too, and the ratio with it.
3. See the parts of the AC, largest first:
   ```powershell
   $c = Invoke-RestMethod "$api/analytics/nodes/$ac/children?metric=electors.total" -Headers $ad
   $c.children | ForEach-Object { "$($_.node.code): $($_.metrics.'electors.total')" }
   $c.total.'electors.total'
   ```
   **Expect:** parts 1 and 2, whose voter counts add up to the total. A
   small category, such as the few voters without a recorded gender, may
   show `suppressed`.
4. See part 1's revisions:
   ```powershell
   $p1 = ($c.children | Where-Object { $_.node.code -eq '1' }).node.id
   (Invoke-RestMethod "$api/analytics/nodes/$p1/revisions" -Headers $ad).versions
   ```
   **Expect:** one revision (2026), with its voters, and additions and
   deletions empty.
5. As **volunteer A**, try step 2:
   ```powershell
   $v = SignIn "+919999900002"
   Invoke-RestMethod "$api/analytics/nodes/$ac/summary" -Headers $v
   ```
   **Expect:** `403 Forbidden`.
6. Run the tests:
   ```powershell
   pnpm --filter api test; pnpm --filter api test:int
   ```
   **Expect:** all pass, including "analytics suppression" and "analytics
   API". They add a tiny part of 4 voters and check three things:
   - the part is suppressed, and so is a sibling (so the AC total can't
     reveal it);
   - every summary equals its row in the parent's table;
   - areas outside the admin's are 404.

## Pass criteria

- Steps 2–6 give the expected results.

## Known issues and notes

- There are no filters (by gender, age and so on) yet. When they are
  added, the same threshold applies to each filtered group.
- The seed has no campaign manager, so that role is covered by the role
  check only.
