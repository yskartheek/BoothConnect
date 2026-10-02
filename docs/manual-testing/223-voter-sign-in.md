# #223: Voter sign-in (EPIC + mobile on record + code) and the voter's scope

**Issue:** https://github.com/yskartheek/BoothConnect/issues/223 (epic #222)
**What changed:**

- Voters can sign in to the API with their **voter ID (EPIC)** and a code sent to the **mobile number on their record**:
  - `POST /v1/voter-auth/otp/request {epic, phone}`: always 202. The code is sent only when one active voter has that EPIC and that phone is their current mobile number;
  - `POST /v1/voter-auth/otp/verify {epic, phone, code, deviceId}`: the token pair. Every failure is the same `OTP_INVALID`.
- Nothing reveals whether an EPIC is on the roll, or whose phone is on record.
- A voter's session sees **only itself**:
  - `/v1/me` shows the voter and no assignments;
  - households, voters, sync and geographies return nothing;
  - staff endpoints (visits, sync push, users, audit, analytics) are 403.
- A volunteer whose phone is also on a voter's record: their voter session has no staff rights, and their volunteer sign-in is unchanged.
- Sign-ins are audited (`auth.login`), without the EPIC or the phone.

## Steps

1. Prepare as usual (branch `claude/issue-223-voter-sign-in`, `pnpm install`, `pnpm infra:up`, `pnpm --filter api db:deploy`, `db:seed`), then start the API with development codes:
   ```powershell
   $env:OTP_DEV_MODE = "true"; pnpm --filter api dev
   ```
2. Find the demo voter's EPIC (the seed voter whose mobile on record is `+919999900101`): in Prisma Studio (`pnpm --filter api db:studio`), open `voter`, the first voter of part 1 (serial 1). Copy `source_voter_id`, e.g. `DMO1000001`.
3. In a new PowerShell window:
   ```powershell
   $api = "http://localhost:4000/v1"; $json = "application/json"
   $epic = "DMO1000001"   # from step 2
   Invoke-RestMethod -Method Post -Uri "$api/voter-auth/otp/request" -ContentType $json -Body (@{ epic = $epic; phone = "+919999900101" } | ConvertTo-Json)
   ```
   **Expect:** no output (202), and `Development sign-in code for +919999900101: …` in the API window.
4. Sign in with that code:
   ```powershell
   $code = Read-Host "Code"
   $t = Invoke-RestMethod -Method Post -Uri "$api/voter-auth/otp/verify" -ContentType $json -Body (@{ epic = $epic; phone = "+919999900101"; code = $code; deviceId = "my-laptop" } | ConvertTo-Json)
   $h = @{ Authorization = "Bearer $($t.accessToken)" }
   Invoke-RestMethod "$api/me" -Headers $h
   (Invoke-RestMethod "$api/households" -Headers $h).items.Count
   ```
   **Expect:** `/me` with `voter` set and empty `assignments`; `0` households.
5. Try an unknown EPIC, or the right EPIC with another phone:
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/voter-auth/otp/request" -ContentType $json -Body (@{ epic = "ZZZ0000000"; phone = "+919999900101" } | ConvertTo-Json)
   ```
   **Expect:** the same empty answer as step 3, and **no** code in the API window.

## Pass criteria

- Steps 1–5 give the expected results.

## Known issues and notes

- Codes can be requested 3 times per phone and per EPIC in 10 minutes.
- A voter with no mobile on record can't sign in yet; their booth volunteer adds the number on a visit.
- The app screens for voters come in #226–#228.
