# #43: Offline sync, uploading the phone's queue

**Issue:** https://github.com/yskartheek/BoothConnect/issues/43
**What changed:**

- `POST /v1/sync/push` is how the phone uploads everything it did offline,
  in one batch and in order: new households and members, consents, detail
  changes, visits, address edits and conflict choices.
- **Each change gets its own answer:**
  - **applied**: saved.
  - **duplicate**: it was already saved, e.g. the phone sent its queue again
    after a bad connection. Nothing is saved twice.
  - **conflict**: saved, but someone else changed the same detail first.
    The answer includes both values, so the app can show **Choose value**.
  - **rejected**: not saved, with the reason (outside your area, a
    switched-off field, caste without consent, bad data, …).
- One bad change never stops the rest of the batch.
- A household and its new member can arrive in the same batch: the phone
  gives them IDs, and later changes use those IDs.

## Steps

1. Prepare as usual (branch `claude/issue-43-sync-push`, then `db:deploy`,
   `db:seed`, `pnpm --filter api dev`, with `OTP_DEV_MODE=true`), and paste
   the `SignIn` helper from the #36 guide into a second PowerShell window.
2. As **volunteer A**, build a batch: a new household, a member in it, their
   mobile number and a visit, plus one change that must be refused (booth 2):
   ```powershell
   $a = SignIn "+919999900002"
   $booth = (Invoke-RestMethod "$api/me" -Headers $a).assignments[0].node.id
   $b = SignIn "+919999900003"
   $booth2 = (Invoke-RestMethod "$api/me" -Headers $b).assignments[0].node.id
   $hid = [guid]::NewGuid().ToString(); $mid = [guid]::NewGuid().ToString()
   function K { "m-" + [guid]::NewGuid().ToString() }
   $batch = @{ mutations = @(
     @{ key = (K); type = "household.create"; payload = @{ id = $hid; pollingStationId = $booth; address = @{ house_no = "Q-" + (Get-Random); street = "Queue Street" } } },
     @{ key = (K); type = "member.create"; payload = @{ householdId = $hid; id = $mid; name = "Queued Member"; age = 30 } },
     @{ key = (K); type = "field.change"; payload = @{ entityType = "voter"; entityId = $mid; fieldKey = "mobile_number"; value = "+919000000043"; baseVersion = $null } },
     @{ key = (K); type = "visit.create"; payload = @{ clientId = [guid]::NewGuid().ToString(); householdId = $hid; startedAt = (Get-Date).ToUniversalTime().ToString("o"); outcome = "completed"; formVersion = "2026.1"; memberIdsMet = @($mid) } },
     @{ key = (K); type = "household.create"; payload = @{ pollingStationId = $booth2; address = @{ house_no = "NOPE-1" } } }
   ) } | ConvertTo-Json -Depth 8
   $r = Invoke-RestMethod "$api/sync/push" -Method Post -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body $batch -ContentType "application/json"
   $r.results | Format-Table type, status, code
   ```
   **Expect:** four `applied`, then `rejected` with code `NOT_FOUND`.
3. Send exactly the same batch again, as a phone would after losing the
   answer, but with a new batch key:
   ```powershell
   $r2 = Invoke-RestMethod "$api/sync/push" -Method Post -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body $batch -ContentType "application/json"
   $r2.results | Format-Table type, status, code
   (Invoke-RestMethod "$api/households/$hid" -Headers $a).members.Count
   ```
   **Expect:** four `duplicate` and the same `rejected`, and the household
   still has exactly 1 member.
4. Check the household as the app would show it:
   ```powershell
   $d = Invoke-RestMethod "$api/households/$hid" -Headers $a
   $d.displayAddress; $d.members.name; $d.lastVisit.outcome
   ```
   **Expect:** your Queue Street address, "Queued Member" and `completed`.
5. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "POST /v1/sync/push".

## Pass criteria

- Steps 2–5 give the expected results.

## Known issues and notes

- The phone app's upload queue that sends these comes with the mobile epic.
- A conflict answer includes both values, so the app can show Choose value
  and send a `conflict.resolve` change.
