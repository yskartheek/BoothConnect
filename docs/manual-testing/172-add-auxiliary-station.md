# #172: Adding an auxiliary polling station by hand

**Issue:** https://github.com/yskartheek/BoothConnect/issues/172
**What changed:**

- `POST /v1/geographies` can add an auxiliary polling station (e.g. `408B`)
  under a part. Use it when the roll reader missed one on the cover page,
  or when one is announced after the roll was published.
- Only auxiliary stations can be added. Every part's main station comes
  from its roll.
- The new station takes no voters until its coverage is set (#101).
- A later import of the part that lists the same code links to it rather
  than adding a second one.
- Admins of the part or above only. Recorded in the audit log.

Test data only. Never upload a real roll.

## Steps

1. Prepare as for #101 (`pnpm infra:up`, `db:deploy`, `db:seed`,
   `pnpm --filter api dev` with `OTP_DEV_MODE=true`), and paste the
   `Stations` and `Coverage` helpers and `$ad`, `$ps1`, `$ps1a` from steps
   1–2 of the #101 guide. Then:
   ```powershell
   $part1 = (Invoke-RestMethod "$api/geographies/$ps1" -Headers $ad).parentId
   function Add($body) {
     $headers = $ad + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
     try {
       Invoke-RestMethod -Method Post "$api/geographies" -Headers $headers -ContentType "application/json" -Body ($body | ConvertTo-Json)
     } catch {
       Write-Host "HTTP $($_.Exception.Response.StatusCode.value__): $(($_.ErrorDetails.Message | ConvertFrom-Json).message)"
     }
   }
   ```
2. Add station `1B` to part 1:
   ```powershell
   $b = Add @{ type = "polling_station"; isAuxiliary = $true; parentId = $part1; code = "1B"; name = "Test School Room 3"; address = "Test School, Demo Nagar" }
   $b
   Stations
   ```
   **Expect:** `1B` with `isAuxiliary` True. The layout shows `1` with 31
   voters, `1A` covering section 2 with 30, and `1B` with no coverage and
   0 voters.
3. Try to give `1B` section 2 too, then serial numbers 1–6:
   ```powershell
   Coverage $b.id @{ sections = @(2) }
   Coverage $b.id @{ serials = @{ from = 1; to = 6 } }
   Stations
   ```
   **Expect:** `HTTP 422: Section 2 already covered by 1A`. Then 7 voters
   and 2 households move to `1B`: serials 1–6 (houses 1 and 2), plus the
   volunteer-added member of house 1. The layout shows `1` with 24, `1A`
   with 30 and `1B` with 7.
4. Refused additions:
   ```powershell
   Add @{ type = "polling_station"; parentId = $part1; code = "1C"; name = "X"; address = "X" }
   Add @{ type = "polling_station"; isAuxiliary = $true; parentId = $part1; code = "1A"; name = "X"; address = "X" }
   Add @{ type = "polling_station"; isAuxiliary = $true; parentId = $part1; code = "1C"; name = "X" }
   ```
   **Expect:**
   - `HTTP 422: Only an auxiliary station can be added by hand; the main station comes from the roll`;
   - `HTTP 409: Part 1 already has a station 1A`;
   - `HTTP 422: An auxiliary station needs its address`.
5. Run the tests:
   ```powershell
   pnpm --filter api test:int -- test/station-add.int-spec.ts
   ```
   **Expect:** 4 pass. They include a new revision of part 1 whose cover
   page lists `1B`: the import links to the station added by hand, and its
   coverage applies.

## Pass criteria

- Steps 2–5 give the expected results.

## Known issues and notes

- A station can't be removed or have its code changed. Rename it with
  `PATCH /v1/geographies/<id>`. Clear its coverage (`null`) to send its
  voters back to the main station.
