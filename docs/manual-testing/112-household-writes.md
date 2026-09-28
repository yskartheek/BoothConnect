# #112: Adding households and members, editing the address and location

**Issue:** https://github.com/yskartheek/BoothConnect/issues/112
**What changed:**

- **Add a household** that isn't on the roll. The address comes in
  separate parts (house number, street, area, PIN code, landmark), as on
  the app's "Household address" screen. You can also save the location in
  the same step; the household's agreement is stored with it.
- **Edit the address** or **save a new location** for any household in your
  area. If someone else changed the address in the meantime, both versions
  are kept as a conflict for the volunteer to choose from (#113), and the
  household keeps showing the current one until then.
- **Add a member** who isn't on the roll: name, age, gender and any other
  details. A detail that can't be saved (e.g. caste without consent) is
  reported, but the member is still added.
- The address shown in lists is built from the parts, e.g.
  "12/4, Gandhi Road, Nehru Nagar, 500038".
- Adding a house number that already exists in the part is refused
  (**409**), since that house is probably already there.
- Anything outside your area gives **404 Not found**. Sending the same
  request twice never creates two households or members.

## Steps

1. Prepare as usual (branch `claude/issue-112-household-writes`, then
   `db:deploy`, which applies a new migration, `db:seed`, which adds the
   address and location fields, and `pnpm --filter api dev`, with
   `OTP_DEV_MODE=true`). Paste the `SignIn` helper from the #36 guide into
   a second PowerShell window.
2. As **volunteer A**, find your booth's ID and add a household with a
   location:
   ```powershell
   $a = SignIn "+919999900002"
   $booth = (Invoke-RestMethod "$api/me" -Headers $a).assignments[0].node.id
   $body = @{
     pollingStationId = $booth
     address = @{ house_no = "12/4"; street = "Gandhi Road"; area = "Nehru Nagar"; pin_code = "500038"; landmark = "Near water tank" }
     location = @{ lat = 17.4; lng = 78.5; accuracyM = 8; capturedAt = (Get-Date).ToUniversalTime().ToString("o"); consent = @{ noticeVersion = "2026.1"; method = "in_person_verbal" } }
   } | ConvertTo-Json -Depth 5
   $new = Invoke-RestMethod "$api/households" -Method Post -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body $body -ContentType "application/json"
   $new | Select-Object id, displayAddress, origin, location
   ```
   **Expect:** `displayAddress` is "12/4, Gandhi Road, Nehru Nagar, 500038",
   origin is `volunteer_added`, and a location is shown.
3. Send the same body again with a new key.
   **Expect:** `409 Conflict`, because house 12/4 is already in the part.
4. Add a member:
   ```powershell
   $m = @{ name = "Test Member"; age = 34; gender = "female"; fields = @(@{ fieldKey = "mobile_number"; value = "+919000000112" }) } | ConvertTo-Json -Depth 5
   $r = Invoke-RestMethod "$api/households/$($new.id)/members" -Method Post -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body $m -ContentType "application/json"
   $r.fields | Format-Table fieldKey, status
   (Invoke-RestMethod "$api/households/$($new.id)" -Headers $a).members | Format-Table name, age, gender, epicNumber
   ```
   **Expect:** four fields `applied`, and the member listed with no EPIC
   number.
5. Edit the address without saying which version you started from:
   ```powershell
   $edit = @{ address = @{ house_no = "12/4"; street = "Gandhi Road"; area = "Nehru Nagar"; pin_code = "500039" }; addressBaseVersion = $null } | ConvertTo-Json -Depth 5
   $e = Invoke-RestMethod "$api/households/$($new.id)" -Method Patch -Headers ($a + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body $edit -ContentType "application/json"
   $e.results.address.status
   $e.household.displayAddress
   ```
   **Expect:** `conflict`, because the household already has an address
   and `addressBaseVersion` was empty. The display address is unchanged.
   (With the right base version, which the phone gets from sync, it would
   be `applied`.)
6. Try a household in **booth 2** (take an ID from volunteer B's list, as in
   the #38 guide) with the PATCH from step 5.
   **Expect:** `404 Not Found`.
7. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "household and member writes".

## Pass criteria

- Steps 2–7 give the expected results.

## Known issues and notes

- The phone gets base versions from `/v1/sync/pull`. There's no separate
  endpoint for a household's field values yet.
- Choosing between conflicting addresses comes with #113.
