# #38: Household details (members and last visit)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/38
**What changed:**

- `GET /v1/households/<id>` returns one household:
  - its address and saved location (only if the location was captured
    with consent);
  - its members in roll order, with volunteer-added members last;
  - its last visit.
- For each member you see the name, age and gender. These are the latest
  values a volunteer entered, or the roll's values if nobody has entered
  any. You also see the relative's name, the EPIC number, and a
  `hasConflict` flag when two offline edits disagree.
- Sensitive fields (such as caste) are **never** part of this list.
- A household outside your area gives **404 Not found**, exactly like a
  household that doesn't exist.

## Steps

1. Prepare as for #37 (branch `claude/issue-38-household-detail`, then
   `db:deploy`, `db:seed`, `pnpm --filter api dev`, with `OTP_DEV_MODE=true`),
   and paste the `SignIn` helper from the #36 guide into a second PowerShell
   window.
2. As **volunteer A**, take the first household in the list and open it:
   ```powershell
   $a = SignIn "+919999900002"
   $h = (Invoke-RestMethod "$api/households?limit=1" -Headers $a).items[0]
   $d = Invoke-RestMethod "$api/households/$($h.id)" -Headers $a
   $d | Select-Object displayAddress, status, location, lastVisit
   $d.members | Format-Table serialNo, epicNumber, name, age, gender, relativeName, hasConflict
   ```
   **Expect:**
   - the address and status `active`;
   - `lastVisit` is empty;
   - 3 or 4 members in serial order, each with an EPIC number, name, age
     and gender.
3. Find the household with a volunteer-added member (house `1-3`):
   ```powershell
   $h = (Invoke-RestMethod "$api/households?q=1-3" -Headers $a).items | Where-Object houseKey -eq "1-3"
   (Invoke-RestMethod "$api/households/$($h.id)" -Headers $a).members | Format-Table origin, epicNumber, name, age
   ```
   **Expect:** the last member has origin `volunteer_added`, no EPIC number,
   a name ending in "Demoreddy" and age 19.
4. As **volunteer B** (`+919999900003`), get one of your households' IDs.
   Then, as volunteer A, open that ID:
   ```powershell
   $b = SignIn "+919999900003"
   $other = (Invoke-RestMethod "$api/households?limit=1" -Headers $b).items[0].id
   Invoke-RestMethod "$api/households/$other" -Headers $a
   ```
   **Expect:** an error, `404 Not Found` with code `NOT_FOUND`, the same as
   for a made-up ID:
   ```powershell
   Invoke-RestMethod "$api/households/$([guid]::NewGuid())" -Headers $a
   ```
5. As the **admin** (`+919999900001`), open `$other`.
   **Expect:** 200 with the household details.
6. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "GET /v1/households/:id".

## Pass criteria

- Steps 2–6 give the expected results.

## Known issues and notes

- No visits exist until #41 (recording visits), so `lastVisit` stays empty
  for now. The tests insert visits directly.
- Full member details (every field, with history) come with
  `GET /v1/voters/<id>` (#39).
