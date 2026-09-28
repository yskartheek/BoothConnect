# #113: Editing member details and choosing between conflicting values

**Issue:** https://github.com/yskartheek/BoothConnect/issues/113
**What changed:**

- **Edit a member's details** (name, age, gender, mobile, occupation, caste,
  additional info). Each change counts immediately and the official roll
  data never changes. Each detail comes back as **applied**, **conflict**
  (someone else changed it first; both values are kept) or **rejected**
  (e.g. caste without the person's consent).
- **Choose a value** when two volunteers' edits clash. The value you keep
  becomes the current one, the other stays in the history, and the conflict
  disappears. Doing it twice changes nothing. This also works for household
  addresses: the household shows the address you kept.
- Only volunteers and admins can edit or choose. Caste can't be seen,
  written or chosen by anyone else. Anything outside your area gives
  **404 Not found**.

## Steps

1. Prepare as usual (branch `claude/issue-113-member-edits-conflicts`, then
   `db:deploy`, `db:seed`, `pnpm --filter api dev`, with `OTP_DEV_MODE=true`),
   and paste the `SignIn` helper from the #36 guide into a second PowerShell
   window.
2. As **volunteer A**, pick a member and edit their occupation:
   ```powershell
   $a = SignIn "+919999900002"
   $h = (Invoke-RestMethod "$api/households?limit=1" -Headers $a).items[0]
   $m = (Invoke-RestMethod "$api/households/$($h.id)" -Headers $a).members[1]
   function Edit($value, $base) {
     $b = @{ fields = @(@{ fieldKey = "occupation"; value = $value; baseVersion = $base }) } | ConvertTo-Json -Depth 5
     (Invoke-RestMethod "$api/voters/$($m.id)" -Method Patch -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body $b -ContentType "application/json").fields[0]
   }
   $base = Edit "Tailor" $null
   $base.status
   ```
   **Expect:** `applied` (or `conflict` if this member already had an
   occupation; pick another member).
3. Make a conflict: two edits that both start from `$base`:
   ```powershell
   $one = Edit "Farmer" $base.fieldValueId
   $two = Edit "Trader" $base.fieldValueId
   "$($one.status) / $($two.status)"
   ```
   **Expect:** `applied / conflict`.
4. See it the way the phone will, then choose "Farmer":
   ```powershell
   (Invoke-RestMethod "$api/voters/$($m.id)" -Headers $a).fields | Where-Object key -eq "occupation" | ForEach-Object { $_.current.value }
   $r = Invoke-RestMethod "$api/conflicts/$($two.fieldValueId)/resolve" -Method Post -Headers $a -Body (@{ keepFieldValueId = $one.fieldValueId } | ConvertTo-Json) -ContentType "application/json"
   $r.status
   (Invoke-RestMethod "$api/voters/$($m.id)?history=true" -Headers $a).fields | Where-Object key -eq "occupation" | ForEach-Object { "current: $($_.current.value) | history: $($_.history.value -join ', ')" }
   ```
   **Expect:** first both `Farmer` and `Trader`, then `resolved`, then
   `current: Farmer | history: Trader, Tailor`.
5. Run the same resolve again.
   **Expect:** status `already_resolved`; nothing changes.
6. As **volunteer B** (`+919999900003`), try to resolve it.
   **Expect:** `404 Not Found`.
7. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "member edits and conflict resolution".

## Pass criteria

- Steps 2–7 give the expected results.

## Known issues and notes

- The phone sends these through `/v1/sync/push` (#43) when it's back
  online. These endpoints are the online versions.
