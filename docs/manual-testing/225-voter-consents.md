# #225: Voter consents: list and withdraw

**Issue:** https://github.com/yskartheek/BoothConnect/issues/225 (epic #222)
**What changed:** with a voter's session (#223):

- **`GET /v1/voter/me/consents`:** the consents the voter gave (what for, the notice version, how and when, granted or withdrawn).
- **`POST /v1/voter/me/consents/{id}/withdraw`:** withdraws one, in one step:
  - the values it covers (e.g. caste/community) stop being shown and synced at once, and volunteers' phones delete them on their next pull;
  - withdrawing again changes nothing; two withdrawals at once are both fine;
  - another person's consent is "not found";
  - audited as `consent.withdraw`.
- A withdrawn consent can't cover a new value.

## Steps

1. Prepare as in the [#223 guide](223-voter-sign-in.md), steps 1–4 (`$h` is the voter's session for `DMO1000001`).
2. Give the voter a consented detail. As Demo Volunteer A (`$v`, from the [#36 guide](36-geographies.md)'s `SignIn "+919999900002"`), record caste/community with consent using the volunteer app's member screen (#114), or through `POST /v1/sync/push` as in the [#43 guide](43-sync-push.md).
3. As the voter, list the consents:
   ```powershell
   $c = (Invoke-RestMethod "$api/voter/me/consents" -Headers $h).items
   $c | Format-Table purpose, status, capturedAt
   ```
   **Expect:** `caste_community` `granted`.
4. As the volunteer, open the voter (`Invoke-RestMethod "$api/voters/<voter id>" -Headers $v`).
   **Expect:** `caste_community` has a current value.
5. As the voter, withdraw it:
   ```powershell
   $hk = $h + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }
   Invoke-RestMethod -Method Post -Uri "$api/voter/me/consents/$($c[0].id)/withdraw" -Headers $hk
   ```
   **Expect:** `status` `withdrawn` with `withdrawnAt`.
6. As the volunteer, open the voter again.
   **Expect:** `caste_community` has no current value.

## Pass criteria

- Steps 1–6 give the expected results.

## Known issues and notes

- Withdrawing hides the values but doesn't erase them (field values are append-only, ADR-0005). Erasure is #213.
- The app's Privacy screen comes in #228.
