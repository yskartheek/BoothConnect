# #224: The voter's own record: details, shared-detail edits, updates

**Issue:** https://github.com/yskartheek/BoothConnect/issues/224 (epic #222)
**What changed:** with a voter's session (#223), three endpoints under `/v1/voter/me`. The voter is always the session's; no request names a voter.

- **`GET /v1/voter/me`:**
  - the official roll data as printed (name, relation, age, gender, house number), EPIC, section and serial;
  - the part, the booth, the program and the household address;
  - the details the voter may share (mobile number, occupation, additional info) with their current values.
- **`PATCH /v1/voter/me/details`:**
  - changes those shared details: each is the current value at once, marked as shared by the voter, or a conflict if someone changed it meanwhile;
  - name, age, gender and restricted details (caste/community) are refused.
- **`GET /v1/voter/me/updates`:** what happened to the record, newest first:
  - which detail changed and who changed it ("you", the booth volunteer, an administrator), never the values;
  - visits to the household;
  - when the voter joined.
- Volunteers and admins see the voter's edits in the voter record, marked as the voter's.
- Staff sessions get 403 on these; the voter still can't reach anyone else's record.

## Steps

1. Prepare as in the [#223 guide](223-voter-sign-in.md), steps 1–4, so that `$h` holds the voter's session (EPIC `DMO1000001`, mobile `+919999900101`).
2. Read the record:
   ```powershell
   $me = Invoke-RestMethod "$api/voter/me" -Headers $h
   $me.official; $me.booth; $me.shared | Format-Table key, value
   ```
   **Expect:** the roll's name, age and gender; booth `1`, "Demo Primary School, Room 1"; mobile `+919999900101`, an occupation, and no additional info.
3. Change the occupation, and try to change the age:
   ```powershell
   $occ = ($me.shared | Where-Object key -eq "occupation").fieldValueId
   $body = @{ fields = @(
     @{ fieldKey = "occupation"; value = "Synthetic Potter"; baseVersion = $occ },
     @{ fieldKey = "age"; value = 30; baseVersion = $null }
   ) } | ConvertTo-Json -Depth 4
   $hk = $h + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }
   (Invoke-RestMethod -Method Patch -Uri "$api/voter/me/details" -Headers $hk -ContentType $json -Body $body).fields | Format-Table fieldKey, status, code
   ```
   **Expect:** `occupation applied`, and `age rejected FORBIDDEN`.
4. Read the updates:
   ```powershell
   (Invoke-RestMethod "$api/voter/me/updates" -Headers $h).items | Select-Object -First 4 | Format-Table kind, fieldKey, by, outcome, at
   ```
   **Expect:** first, `detail occupation you`; then `joined`, and the earlier changes by `volunteer`.
5. As Demo Volunteer A (sign in with the [#36 guide](36-geographies.md)'s `SignIn "+919999900002"`), open the voter: `Invoke-RestMethod "$api/voters/$($me.id)" -Headers $v`.
   **Expect:** the occupation's current value is "Synthetic Potter" with `sourceType` `voter_self_submitted`.
6. With the volunteer's session, `Invoke-RestMethod "$api/voter/me" -Headers $v`.
   **Expect:** 403.

## Pass criteria

- Steps 1–6 give the expected results.

## Known issues and notes

- Additional info is free text; the app will warn against health, religion or party details, as the volunteer form does.
- The app screens come in #227 and #228.
