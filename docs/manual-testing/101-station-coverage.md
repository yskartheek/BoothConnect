# #101: Auxiliary polling stations, coverage by section or serial range

**Issue:** https://github.com/yskartheek/BoothConnect/issues/101
**What changed:**

- A part has one main polling station and may have auxiliary ones (e.g.
  `408A`). Review already proposes them from the roll's cover page, and
  confirm creates them.
- `GET /v1/geographies/<part or station id>/stations` (admin) lists the
  part's stations with their coverage and voter counts.
- `PUT /v1/geographies/<station id>/coverage` (admin) sets which sections or
  serial numbers an auxiliary station takes, or clears it with `null`.
  Voters move at once; everyone not covered is at the main station.
  Households follow their members, and members added by volunteers follow
  their household.
- Overlaps are rejected: a shared section, overlapping serial ranges, or any
  voter that would be in two stations. A main station can't have a
  coverage.
- Each change is audited (`geography.coverage`) and refreshes the part's
  analytics. Phones on the part's booths get a full fresh copy at their next
  sync, so a volunteer stops seeing voters who moved away.

The seed has part 1 with main station `1` and auxiliary station `1A`, which
covers section 2 (serial numbers 31–60). Test data only; never upload a
real roll.

## Steps

1. Prepare as for #36: `pnpm infra:up`, `pnpm --filter api db:deploy`,
   `pnpm --filter api db:seed`, then `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`, and the `SignIn` helper from the #36 guide. Then:
   ```powershell
   $ad = SignIn "+919999900001"
   $v = SignIn "+919999900002"
   $ps1 = (Invoke-RestMethod "$api/me" -Headers $v).assignments[0].node.id
   function Stations {
     (Invoke-RestMethod "$api/geographies/$ps1/stations" -Headers $ad).stations |
       Format-Table code, isAuxiliary, @{ n = 'coverage'; e = { $_.coverage | ConvertTo-Json -Compress } }, voters
   }
   function Coverage($stationId, $coverage) {
     $headers = $ad + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
     $body = @{ coverage = $coverage } | ConvertTo-Json -Depth 5
     try {
       $r = Invoke-RestMethod -Method Put "$api/geographies/$stationId/coverage" -Headers $headers -ContentType "application/json" -Body $body
       $r.moved
     } catch {
       Write-Host "HTTP $($_.Exception.Response.StatusCode.value__): $(($_.ErrorDetails.Message | ConvertFrom-Json).message)"
     }
   }
   ```
2. Show part 1's stations:
   ```powershell
   Stations
   $ps1a = ((Invoke-RestMethod "$api/geographies/$ps1/stations" -Headers $ad).stations | Where-Object code -eq '1A').id
   ```
   **Expect:** `1` with 31 voters (30 from the roll, and 1 added by a
   volunteer), and `1A` covering `{"sections":[2]}` with 30.
3. Volunteer A (station 1) syncs:
   ```powershell
   $p = Invoke-RestMethod "$api/sync/pull" -Headers $v
   $p.voters.Count; $cursor = $p.cursor
   ```
   **Expect:** 31.
4. Make `1A` take serial numbers 1–15 instead of section 2:
   ```powershell
   Coverage $ps1a @{ serials = @{ from = 1; to = 15 } }
   Stations
   ```
   **Expect:** `voters` 46 and `households` 15 moved: section 2 goes back to
   `1`, and houses 1–5 (serials 1–15, plus the volunteer-added member of
   house 1) go to `1A`. Then `1` has 45 voters and `1A` has 16.
5. Volunteer A syncs again from where they were:
   ```powershell
   $p = Invoke-RestMethod "$api/sync/pull?since=$([uri]::EscapeDataString($cursor))" -Headers $v
   $p.reset; $p.voters.Count
   ```
   **Expect:** `True` and 45: a fresh copy without the voters now at `1A`.
6. Rejected changes:
   ```powershell
   Coverage $ps1a @{ serials = @{ from = 20; to = 10 } }
   Coverage $ps1 @{ sections = @(5) }
   ```
   **Expect:** `HTTP 422: The serial range starts after it ends`, then
   `HTTP 422: Only an auxiliary station has a coverage; …`.
7. Clear `1A`, then put back the seed's coverage:
   ```powershell
   Coverage $ps1a $null
   Coverage $ps1a @{ sections = @(2) }
   Stations
   ```
   **Expect:** first 16 voters and 5 households move back to `1`; then 30
   voters and 10 households move to `1A`. The layout is as in step 2.
8. The changes are in the audit log:
   ```powershell
   (Invoke-RestMethod "$api/audit-events?action=geography.coverage" -Headers $ad).items |
     Format-Table seq, @{ n = 'metadata'; e = { $_.metadata | ConvertTo-Json -Compress -Depth 5 } }
   ```
   **Expect:** three events with the coverage and the counts moved; no
   voter names.
9. Run the tests:
   ```powershell
   pnpm --filter api test -- coverage
   pnpm --filter api test:int -- test/station-coverage.int-spec.ts
   ```
   **Expect:** all pass (8 integration tests). They include two auxiliary
   stations whose coverages overlap, and an admin of another part.

## Pass criteria

- Steps 2–9 give the expected results.

## Known issues and notes

- Auxiliary stations can be added by hand since #172. The
  `172-add-auxiliary-station.md` guide shows two of them overlapping.
- Voters without a section or serial number (added by volunteers) move with
  their household. A household whose members are split between stations
  goes to the station most of them are at.
