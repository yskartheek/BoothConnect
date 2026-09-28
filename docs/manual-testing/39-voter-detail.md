# #39: Member details (official values, current values, history)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/39
**What changed:**

- `GET /v1/voters/<id>` returns one member with:
  - **the official values** exactly as printed in the roll (these never
    change);
  - **each field** (name, age, gender, mobile, occupation, caste,
    additional info) with its current value, who set it and when. Each
    value has an `id`, which the app sends back when editing, so the
    server can spot two edits made offline at the same time.
- `?history=true` also returns every earlier value of each field.
- Fields that are switched off (religion, political affiliation) are
  **never** returned.
- Caste/community is shown only to volunteers and admins, and only while
  the voter's consent stands. Campaign managers never see it.
- A member outside your area gives **404 Not found**, exactly like one
  that doesn't exist.

## Steps

1. Prepare as for #38 (branch `claude/issue-39-voter-detail`, then
   `db:deploy`, `db:seed`, `pnpm --filter api dev`, with `OTP_DEV_MODE=true`),
   and paste the `SignIn` helper from the #36 guide into a second PowerShell
   window.
2. As **volunteer A**, open the first member of house `1-3`:
   ```powershell
   $a = SignIn "+919999900002"
   $h = (Invoke-RestMethod "$api/households?q=1-3" -Headers $a).items | Where-Object houseKey -eq "1-3"
   $m = (Invoke-RestMethod "$api/households/$($h.id)" -Headers $a).members[0]
   $v = Invoke-RestMethod "$api/voters/$($m.id)" -Headers $a
   $v.official
   $v.fields | Format-Table key, isRestricted, @{n='current';e={$_.current.value -join ', '}}, @{n='by';e={$_.current.collectedBy.name}}
   ```
   **Expect:**
   - `official` shows the printed name, relation, age and gender;
   - `fields` lists name, age, gender, mobile_number, occupation,
     additional_info and caste_community;
   - occupation and mobile_number have values entered by the volunteer;
   - religion and political_affiliation are **not** listed.
3. With history:
   ```powershell
   (Invoke-RestMethod "$api/voters/$($m.id)?history=true" -Headers $a).fields | Format-Table key, @{n='history';e={$_.history.Count}}
   ```
   **Expect:** a `history` count for every field, 0 for all of them, since
   no value has been edited yet. Edits come with #40.
4. As **volunteer B** (`+919999900003`), open the same member:
   ```powershell
   $b = SignIn "+919999900003"
   Invoke-RestMethod "$api/voters/$($m.id)" -Headers $b
   ```
   **Expect:** an error, `404 Not Found` with code `NOT_FOUND`.
5. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "GET /v1/voters/:id". The tests cover
   caste being hidden from campaign managers and after consent is
   withdrawn, and history after two edits.

## Pass criteria

- Steps 2–5 give the expected results.

## Known issues and notes

- The seed has no campaign manager, so hiding caste from other roles is
  covered by the tests only.
- Which roles may see caste is a single list in the code
  (`RESTRICTED_FIELD_ROLES`: admin and volunteer).
