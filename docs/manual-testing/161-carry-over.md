# #161: Carrying volunteer data over to the same voter in a new roll revision

**Issue:** https://github.com/yskartheek/BoothConnect/issues/161
**What changed:**

- When a new revision of a part is confirmed, a voter with the same EPIC
  number as before gets a new record linked to the old one. What volunteers
  recorded on the old record is carried over in the same transaction:
  - **details** (phone, occupation, …): the current values are copied, with
    the same collector, time and consent, and a link to where they came
    from;
  - **consents:** a consent given on the old record still covers the voter.
    Withdrawn consents stay withdrawn, and their values are not copied;
  - **visits:** the voter's page lists the visits that met them on any of
    their records;
  - **open conflicts** stay open, on the new record.
- The old record and everything on it stay exactly as they were.
- A phone that was offline during the revision can still send edits or
  conflict choices for the old record. They are applied to the new one.
- Voters with a new EPIC start empty.

Test data only. Never upload a real roll.

## Steps

A new revision needs a reviewed roll file. The development seed has no
second revision to confirm by hand, so the revision itself is covered by the
tests in step 4. Steps 2 and 3 show the new fields on the seed's data.

1. Prepare as for #36: `pnpm infra:up`, `pnpm --filter api db:deploy`,
   `pnpm --filter api db:seed`, then `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`, and the `SignIn` helper from the #36 guide.
2. As volunteer B (station 2), record a visit that meets the first member of
   a household:
   ```powershell
   $v = SignIn "+919999900003"
   $h = (Invoke-RestMethod "$api/households?limit=1" -Headers $v).items[0]
   $member = (Invoke-RestMethod "$api/households/$($h.id)" -Headers $v).members[0].id
   $headers = $v + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
   $visit = @{ clientId = [guid]::NewGuid().ToString(); householdId = $h.id; startedAt = (Get-Date).ToUniversalTime().ToString('o'); outcome = 'completed'; formVersion = '2026.1'; memberIdsMet = @($member) } | ConvertTo-Json
   Invoke-RestMethod -Method Post "$api/visits" -Headers $headers -ContentType "application/json" -Body $visit | Out-Null
   ```
3. Look at the member:
   ```powershell
   $d = Invoke-RestMethod "$api/voters/$member" -Headers $v
   $d.previousVoterIds.Count
   $d.visitsMet | Format-Table id, startedAt, outcome, @{ n = 'volunteer'; e = { $_.volunteer.name } }
   ```
   **Expect:** 0 earlier records (the seed has one revision), and the
   visit from step 2. After a new revision, the member's new record would
   show this same visit, with the old record's ID in `previousVoterIds`.
4. Run the tests:
   ```powershell
   pnpm --filter api test -- carry-over
   pnpm --filter api test:int -- test/carry-over.int-spec.ts
   ```
   **Expect:** 2 and 10 pass. The integration tests confirm a synthetic new
   revision of seed part 2 and check that:
   - the same EPIC keeps its current values, with collector, time and
     consent, plus its granted consent and its visit;
   - a new EPIC starts empty;
   - a withdrawn consent isn't revived, and its values stay behind;
   - an open conflict stays open;
   - nothing on the superseded records changes;
   - a failed commit carries nothing;
   - sync sends the new record with its values and `previousVoterIds`, and
     lists conflicts only on the new record;
   - offline edits and conflict choices for the old record land on the new
     one;
   - the commit's audit event has the counts.

## Pass criteria

- Steps 3 and 4 give the expected results.

## Known issues and notes

- A voter whose EPIC moves to another part is not linked yet. It needs both
  parts' revisions and a later decision.
- An EPIC printed twice in either revision isn't linked; that voter starts
  empty.
- Visits keep the record they met. The phone finds a voter's visits
  through `previousVoterIds` (sync pull), the same way the voter page does.
