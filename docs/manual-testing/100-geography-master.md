# #100: Geography master data (States, PCs and ACs from a CSV)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/100
**What changed:**

- `POST /v1/geographies/imports` takes the State → PC → AC list as a CSV
  (template: `docs/templates/geography-master.csv`, synthetic rows). It
  first shows what each row would do (`create`, `update`, `unchanged` or
  `error` with reasons); with `confirm: true` it saves all rows, or none
  when any row has an error.
- Uploading the same file again changes nothing. Changing a name or a
  reservation updates it. Nothing is ever deleted.
- `POST /v1/geographies` adds one State, PC or AC; `PATCH
/v1/geographies/<id>` renames one or changes its reservation.
- An admin changes only their own area. An admin of a State manages the
  whole list, including adding States. All changes are in the audit log.

Test files only; never upload a real roll or real voter data.

## Steps

1. Prepare as for #36: `pnpm infra:up`, `pnpm --filter api db:deploy`,
   `pnpm --filter api db:seed`, then `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`, and the `SignIn` helper from the #36 guide. Then,
   from the repository root:
   ```powershell
   $ad = SignIn "+919999900001"
   function Upload($path, $confirm) {
     $headers = $ad + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
     $body = @{ csv = (Get-Content $path -Raw); confirm = $confirm } | ConvertTo-Json
     try {
       $r = Invoke-RestMethod -Method Post "$api/geographies/imports" -Headers $headers -ContentType "application/json" -Body $body
     } catch {
       Write-Host "HTTP $($_.Exception.Response.StatusCode.value__)"
       $r = ($_.ErrorDetails.Message | ConvertFrom-Json).details
     }
     if ($r) {
       $r.counts
       $r.rows | Format-Table line, level, code, action, @{ n = 'errors'; e = { $_.errors -join '; ' } }
     }
   }
   ```
2. The seed admin only has AC 101. Preview the template:
   ```powershell
   Upload docs/templates/geography-master.csv $false
   ```
   **Expect:** every row is `error`: line 2 "Outside your area" (an AC
   admin can't add States), and the rows below it "Its State (line 2) has
   errors" or "Its PC (line …) has errors".
3. Make the seed admin an admin of State S99 too. An admin can only give
   roles at or below their own node, so a State admin is set up from the
   server (#173). In a second window, from the repository root:
   ```powershell
   pnpm --filter api build
   pnpm --filter api admin:grant --phone +919999900001 --name "Demo Admin" --node S99
   ```
   **Expect:** "Admin role granted: user …".
4. Preview again, then confirm:
   ```powershell
   Upload docs/templates/geography-master.csv $false
   Upload docs/templates/geography-master.csv $true
   ```
   **Expect:** both show `create` 6. The preview saves nothing; the confirm
   saves the new State S98 with its two PCs and three ACs.
5. Upload the same file again:
   ```powershell
   Upload docs/templates/geography-master.csv $true
   ```
   **Expect:** `unchanged` 6, `create` 0.
6. Change a name and add a row with a mistake:
   ```powershell
   $csv = (Get-Content docs/templates/geography-master.csv -Raw) -replace 'Hillside Sample', 'Hilltop Sample'
   $csv += "ac,99,Orphan AC,,77,S98`n"
   Set-Content $env:TEMP\master.csv $csv
   Upload $env:TEMP\master.csv $true
   ```
   **Expect:** `HTTP 422`, and the report shows line 8 `error` "Unknown PC
   77" and line 7 `update`. Nothing was saved. Remove the last line from
   `$env:TEMP\master.csv` and run `Upload $env:TEMP\master.csv $true`
   again: **Expect** `update` 1.
7. Change one AC's reservation directly:
   ```powershell
   $ac = (Invoke-RestMethod "$api/me" -Headers $ad).assignments |
     Where-Object { $_.node.type -eq 'ac' } | Select-Object -First 1
   $headers = $ad + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
   Invoke-RestMethod -Method Patch "$api/geographies/$($ac.node.id)" -Headers $headers -ContentType "application/json" -Body (@{ reservation = 'SC' } | ConvertTo-Json)
   ```
   **Expect:** AC 101 with `reservation` `SC`.
8. The changes are in the audit log:
   ```powershell
   (Invoke-RestMethod "$api/audit-events?action=geography.*" -Headers $ad).items |
     Format-Table seq, action, resourceType, @{ n = 'metadata'; e = { $_.metadata | ConvertTo-Json -Compress } }
   ```
   **Expect:** `geography.update` with `{"fields":["reservation"]}`, and
   `geography.import` rows with the created, updated and unchanged counts.
9. Run the tests:
   ```powershell
   pnpm --filter api test -- master-data
   pnpm --filter api test:int -- test/geography-master.int-spec.ts
   ```
   **Expect:** 6 and 10 pass.

## Pass criteria

- Steps 2–9 give the expected results.

## Known issues and notes

- Step 3 uses `admin:grant`, the server command for setting up the first
  admin of an area above the caller's own (#173).
- Since #103, a State admin sees every State, PC and AC of the program in
  `GET /v1/geographies`, including new States such as S98.
- To start again, run `pnpm --filter api db:reset` and seed again.
