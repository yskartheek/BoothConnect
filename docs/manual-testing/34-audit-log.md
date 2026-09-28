# #34: Audit log for sign-in and sign-out

**Issue:** https://github.com/yskartheek/BoothConnect/issues/34
**What changed:**

- Every sign-in attempt and every sign-out is now written to the **audit
  log** (`audit_event`):
  - a successful sign-in: who, which device session, the request ID;
  - a failed sign-in: the reason (for example `OTP_INVALID`), attributed to
    the account if the phone has one. **The phone number and the code are
    never stored**;
  - a sign-out: who and which session.
- The log is **tamper-evident**: each event contains a hash of the previous
  one, and the database refuses to change or delete events (set up in #25).
  A check (`audit_verify_chain()`) confirms nothing was altered.
- Anything extra stored with an event is **cleaned first**: secrets, codes,
  tokens and personal data (names, phone numbers, addresses, voter ID
  numbers, ages, locations…) are replaced by `[REDACTED]`.
- Developers can mark any endpoint with `@Audited(...)` to log every call,
  successful or not; later features (households, visits, imports) will use it.

## Steps

1. Check out the branch and prepare as for #30:
   ```powershell
   git checkout claude/issue-34-audit
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   pnpm --filter api db:seed
   pnpm --filter api dev
   ```
   Keep `OTP_DEV_MODE=true` in `.env`.
2. In a second PowerShell window, try a wrong code, then sign in properly as
   the admin (the code is in the API window's log; replace `123456`), then
   sign out:
   ```powershell
   $api = "http://localhost:4000/v1"
   Invoke-WebRequest -Method Post -Uri "$api/auth/otp/request" -ContentType "application/json" -Body '{"phone":"+919999900001"}' | Select-Object StatusCode
   try { Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType "application/json" -Body '{"phone":"+919999900001","code":"000000","deviceId":"my-laptop"}' } catch { "wrong code: 401" }
   $t = Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType "application/json" -Body '{"phone":"+919999900001","code":"123456","deviceId":"my-laptop"}'
   Invoke-WebRequest -Method Post -Uri "$api/auth/logout" -Headers @{ Authorization = "Bearer $($t.accessToken)" } | Select-Object StatusCode
   ```
3. Look at the log:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "select seq, action, result, metadata, left(hash, 12) as hash, left(prev_hash, 12) as prev from audit_event order by seq"
   ```
   **Expect:** three new rows: `auth.login | failure | {"reason": "OTP_INVALID"}`,
   `auth.login | success | {}` and `auth.logout | success | {}`. Each
   row's `prev` equals the previous row's `hash`. Nowhere is there a phone
   number, a code or a token.
4. Check the chain and try to tamper with it:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "select audit_verify_chain()"
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "update audit_event set result = 'success' where result = 'failure'"
   ```
   **Expect:** the first gives an empty result (the chain is intact); the
   second fails with an error saying the audit log is append-only.
5. Run the tests:
   ```powershell
   pnpm --filter api test
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "redact" and "audit log".

## Pass criteria

- Steps 3–5 give the expected results.

## Known issues and notes

- **Only sign-in and sign-out are audited so far.** Data changes (households,
  visits, field values, imports) will be audited as those endpoints are built
  (Epic 4), with `@Audited(...)`.
- **An audit explorer** in the admin web comes in #77.
- Code requests (`otp/request`) aren't audited: the phone number is the only
  detail, and it can't be stored.
