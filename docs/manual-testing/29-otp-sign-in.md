# #29: Sign-in with a one-time code (OTP), development version

**Issue:** https://github.com/yskartheek/BoothConnect/issues/29
**What changed:**

- `POST /v1/auth/otp/request` with a phone number:
  - always answers **202 Accepted**, whether or not the number is registered,
    so nobody can use it to find out who has an account;
  - only an **active** user gets a code (6 digits, valid for 5 minutes);
  - the code is stored only as a keyed hash in Redis, never in plain text;
  - each phone number can ask for 3 codes per 10 minutes, then gets 429
    `RATE_LIMITED` (registered or not).
- **No SMS is sent yet.** With `OTP_DEV_MODE=true` (the default in
  `.env.example`) the code is written to the API log. The API refuses to start
  in production with that setting.
- `POST /v1/auth/otp/verify` with the phone, the code and a device ID:
  - the right code returns an **access token** (15 minutes) and a **refresh
    token**, and creates a session for that device;
  - a code works only once;
  - a wrong code gives 401 `OTP_INVALID`; after 5 wrong codes the code is
    deleted (401 `OTP_LOCKED`) and a new one must be requested.
- Refreshing tokens, signing out and checking tokens on every request come
  next (#30, #31).
- Also: API integration tests can now be run with Jest directly (for example
  from an editor), not only through `pnpm --filter api test:int`.

## Steps

1. Check out the branch, install, start the services, and prepare the
   database with the demo users:
   ```powershell
   git checkout claude/issue-29-otp-auth
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   pnpm --filter api db:seed
   ```
2. Make sure your `.env` has `OTP_DEV_MODE=true` (compare with
   `infra/env/.env.example`), then start the API and leave this window open:
   ```powershell
   pnpm --filter api dev
   ```
3. In a **second** PowerShell window, ask for a code for the demo admin:
   ```powershell
   $api = "http://localhost:4000/v1"
   Invoke-WebRequest -Method Post -Uri "$api/auth/otp/request" -ContentType "application/json" -Body '{"phone":"+919999900001"}' | Select-Object StatusCode
   ```
   **Expect:** `202`. In the API window, a log line
   `Development sign-in code for +919999900001: 123456` (your code differs).
4. Sign in with that code (replace `123456`):
   ```powershell
   $tokens = Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType "application/json" -Body '{"phone":"+919999900001","code":"123456","deviceId":"my-laptop"}'
   $tokens
   ```
   **Expect:** `accessToken` (a long `eyJ…` value), `refreshToken`,
   `tokenType` `Bearer` and `expiresIn` `900`.
5. Try the same code again:
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType "application/json" -Body '{"phone":"+919999900001","code":"123456","deviceId":"my-laptop"}'
   ```
   **Expect:** an error with status 401 and `"code":"OTP_INVALID"` (codes
   work once).
6. Ask for a code for a number that isn't registered:
   ```powershell
   Invoke-WebRequest -Method Post -Uri "$api/auth/otp/request" -ContentType "application/json" -Body '{"phone":"+919000000000"}' | Select-Object StatusCode
   ```
   **Expect:** `202`, the same as for a registered number, and **no** code
   in the API log.
7. Run the same request three more times.
   **Expect:** the fourth request in 10 minutes fails with 429 and
   `"code":"RATE_LIMITED"`.
8. Optional: look at the session. Run `pnpm --filter api db:studio`, open
   `session`, and check the row for `my-laptop`: `refresh_hash` is a
   64-character hash, not the refresh token from step 4.
9. Run the tests:
   ```powershell
   pnpm --filter api test
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "OTP sign-in (real Postgres and Redis)".

## Pass criteria

- Steps 3–7 give the expected results and step 9 passes.

## Known issues and notes

- **No SMS provider yet.** With `OTP_DEV_MODE=false`, requests still answer
  202, but the code isn't delivered (the API logs an error without the code).
  An SMS integration is a separate task.
- **Tokens can't be used for anything yet.** Endpoints that need sign-in come
  with #30 (token checks), #31 (suspended users) and #32 (`GET /v1/me`).
- Sign-in events aren't in the audit log yet; that's #34.
- The demo phone numbers come from the seed (#26): admin `+919999900001`,
  volunteer A `+919999900002`, volunteer B `+919999900003`.
