# #42: Offline sync, downloading changes (+ visit corrections)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/42
**What changed:**

- `GET /v1/sync/pull` is how the phone keeps an offline copy of its booth:
  - **First run:** it downloads everything the volunteer needs: households,
    members, fields, current details and visits.
  - **After that:** it downloads only what changed since the last time,
    including values that were replaced, members removed from the roll and
    fields switched off.
  - **Conflicts:** every pull lists all open conflicts (two different values
    for the same detail) with who entered each and when, so the app can show
    **Choose value**.
  - **Consent:** if a voter withdraws consent, their sensitive value is
    removed from the phone.
  - **Area:** only the volunteer's own booth is ever included. If their
    booths change, the phone gets a fresh full copy.
  - **Large downloads** come in pages.
- **Visit corrections** (asked for in review of #41): a visit can now
  correct an earlier one ("edit from list"). Both are kept, but the
  household shows the correction. Only the volunteer who recorded the visit,
  or an admin, can correct it, and only once.

## Steps

1. Prepare as usual (branch `claude/issue-42-sync-pull`, then `db:deploy`, which
   applies a new migration, `db:seed`, `pnpm --filter api dev`, with
   `OTP_DEV_MODE=true`), and paste the `SignIn` helper from the #36 guide into
   a second PowerShell window.
2. As **volunteer A**, do a first pull:
   ```powershell
   $a = SignIn "+919999900002"
   $p = Invoke-RestMethod "$api/sync/pull" -Headers $a
   "reset=$($p.reset) more=$($p.hasMore) households=$($p.households.Count) members=$($p.voters.Count) fields=$($p.fieldDefinitions.Count) values=$($p.fieldValues.Count)"
   ```
   **Expect:** `reset=True more=False`, 10 households, about 31 members, 7
   fields (religion and political affiliation aren't there), and a few
   values.
3. Pull again straight away with the cursor:
   ```powershell
   $p2 = Invoke-RestMethod "$api/sync/pull?since=$($p.cursor)" -Headers $a
   "reset=$($p2.reset) households=$($p2.households.Count) values=$($p2.fieldValues.Count)"
   ```
   **Expect:** `reset=False` and zeros: nothing changed.
4. Record a visit that changes a detail (steps 2–3 of the #41 guide), then
   pull with the cursor from step 3:
   ```powershell
   $p3 = Invoke-RestMethod "$api/sync/pull?since=$($p2.cursor)" -Headers $a
   $p3.visits | Select-Object outcome, startedAt
   $p3.fieldValues | Select-Object fieldKey, value, isCurrent
   ```
   **Expect:** just your visit and the detail you changed.
5. Pages: pull everything 5 rows at a time:
   ```powershell
   $c = $null; $n = 0
   do { $q = Invoke-RestMethod "$api/sync/pull?limit=5$(if ($c) { "&since=$c" })" -Headers $a; $c = $q.cursor; $n++ } while ($q.hasMore)
   "pages=$n"
   ```
   **Expect:** more than 10 pages, and the loop ends.
6. As **volunteer B** (`+919999900003`), do step 2.
   **Expect:** only booth 2's households; none of the IDs from step 2.
7. **Visit correction:** as volunteer A, correct the visit from step 4
   (use its `id`):
   ```powershell
   $fix = @{ clientId = [guid]::NewGuid().ToString(); householdId = $h.id; startedAt = (Get-Date).ToUniversalTime().ToString("o"); outcome = "refused"; formVersion = "2026.1"; correctsVisitId = $r.id } | ConvertTo-Json
   Invoke-RestMethod "$api/visits" -Method Post -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body $fix -ContentType "application/json" | Select-Object id, outcome, correctsVisitId
   (Invoke-RestMethod "$api/households/$($h.id)" -Headers $a).lastVisit.outcome
   ```
   **Expect:** the new visit has `correctsVisitId` set, and the household's
   last visit is now `refused`. Sending the same correction again (new
   `clientId`) gives `409 Conflict`.
8. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "GET /v1/sync/pull" and the corrections
   tests in "POST /v1/visits".

## Pass criteria

- Steps 2–8 give the expected results.

## Known issues and notes

- Choosing a value to resolve a conflict comes with #113. Until then,
  conflicts only appear (tests create them directly).
- The phone app that uses this comes in the mobile epic.
