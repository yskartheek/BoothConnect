# #41: Recording a visit

**Issue:** https://github.com/yskartheek/BoothConnect/issues/41
**What changed:**

- `POST /v1/visits` records a visit to a household. A visit includes:
  - the outcome (completed, no one available, refused, …);
  - the times, and notes;
  - who the volunteer met;
  - any consents given (e.g. caste/community);
  - any member details changed during the visit.
- Everything in one visit is saved together, or not at all. The visit is
  also written to the audit log.
- Each detail change comes back as **applied**, **conflict** (someone else
  changed it first; both values are kept) or **rejected** (e.g. caste
  without consent). A rejected change doesn't stop the visit.
- Sending the same visit twice (a retry after a bad connection) stores it
  **once** and returns the same answer.
- A household outside your area gives **404 Not found**.

## Steps

1. Prepare as for #39 (branch `claude/issue-41-visits`, then `db:deploy`,
   `db:seed`, `pnpm --filter api dev`, with `OTP_DEV_MODE=true`), and paste
   the `SignIn` helper from the #36 guide into a second PowerShell window.
2. As **volunteer A**, pick a household and its first member:
   ```powershell
   $a = SignIn "+919999900002"
   $h = (Invoke-RestMethod "$api/households?limit=1" -Headers $a).items[0]
   $m = (Invoke-RestMethod "$api/households/$($h.id)" -Headers $a).members[0]
   ```
3. Record a visit that met this member and set their occupation. Keep the
   key so you can resend it:
   ```powershell
   $key = [guid]::NewGuid().ToString()
   $visit = @{
     clientId = [guid]::NewGuid().ToString()
     householdId = $h.id
     startedAt = (Get-Date).ToUniversalTime().AddMinutes(-15).ToString("o")
     completedAt = (Get-Date).ToUniversalTime().ToString("o")
     outcome = "completed"
     formVersion = "2026.1"
     memberIdsMet = @($m.id)
     fieldChanges = @(@{ entityType = "voter"; entityId = $m.id; fieldKey = "occupation"; value = "Tailor"; baseVersion = $null })
   } | ConvertTo-Json -Depth 5
   $hdr = $a + @{ "Idempotency-Key" = $key }
   $r = Invoke-RestMethod "$api/visits" -Method Post -Headers $hdr -Body $visit -ContentType "application/json"
   $r | Select-Object id, outcome, duplicate
   $r.fieldChanges
   ```
   **Expect:** a visit ID, `duplicate` False, and one field change with
   status `applied`. If the seed gave this member an occupation already
   (house `1-3`'s first member has one), the status is `conflict` instead,
   because `baseVersion` was empty.
4. Send exactly the same request again:
   ```powershell
   $r2 = Invoke-WebRequest "$api/visits" -Method Post -Headers $hdr -Body $visit -ContentType "application/json"
   $r2.Headers["Idempotency-Replayed"]
   ($r2.Content | ConvertFrom-Json).id -eq $r.id
   ```
   **Expect:** `true` and `True`: the same visit, not a second one.
5. Check that the household now shows the visit:
   ```powershell
   (Invoke-RestMethod "$api/households/$($h.id)" -Headers $a).lastVisit
   (Invoke-RestMethod "$api/households?status=visited" -Headers $a).items.Count
   ```
   **Expect:** `lastVisit` has your visit ID and outcome `completed`, and the
   visited count is 1.
6. Record a visit to a household in **booth 2** as volunteer A (take a
   household ID from volunteer B's list, as in the #38 guide):
   ```powershell
   $b = SignIn "+919999900003"
   $other = (Invoke-RestMethod "$api/households?limit=1" -Headers $b).items[0].id
   $bad = ($visit | ConvertFrom-Json); $bad.householdId = $other; $bad.clientId = [guid]::NewGuid().ToString(); $bad.fieldChanges = @()
   Invoke-RestMethod "$api/visits" -Method Post -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body ($bad | ConvertTo-Json -Depth 5) -ContentType "application/json"
   ```
   **Expect:** an error, `404 Not Found` with code `NOT_FOUND`.
7. Optional: in Prisma Studio, the `audit_event` table has a `visit.create`
   row for your visit.
8. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "POST /v1/visits".

## Pass criteria

- Steps 3–8 give the expected results.

## Known issues and notes

- Correcting a visit ("edit from list" in the app) isn't part of this
  endpoint yet.
- Visits from the phone's offline queue will go through `/v1/sync/push`
  (#43), which uses the same rules.
