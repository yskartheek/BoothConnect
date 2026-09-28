# #31: Suspended users lose access immediately

**Issue:** https://github.com/yskartheek/BoothConnect/issues/31
**What changed:**

- On every request, the API now checks that the caller's account is
  **active**. A suspended user gets 401 `UNAUTHENTICATED` on their next
  request, even though their access token would otherwise be valid for up to
  15 more minutes (spec §7.1).
- A suspended user can't refresh their tokens or receive a sign-in code.
- Suspension doesn't sign the user out: when they are reactivated, their
  devices work again without signing in.
- The check is a single database query per request and isn't cached, so a
  change takes effect on the very next request.

There's no screen or endpoint to suspend someone yet (that comes with user
management in the admin web), so this guide changes the status directly in
the database.

## Steps

1. Check out the branch and prepare as for #30:
   ```powershell
   git checkout claude/issue-31-suspended-users
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   pnpm --filter api db:seed
   pnpm --filter api dev
   ```
   Keep `OTP_DEV_MODE=true` in `.env`.
2. In a second PowerShell window, sign in as volunteer B (the code is in the
   API window's log; replace `123456`):
   ```powershell
   $api = "http://localhost:4000/v1"
   Invoke-WebRequest -Method Post -Uri "$api/auth/otp/request" -ContentType "application/json" -Body '{"phone":"+919999900003"}' | Select-Object StatusCode
   $t = Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType "application/json" -Body '{"phone":"+919999900003","code":"123456","deviceId":"my-laptop"}'
   ```
3. Suspend volunteer B:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "update app_user set status = 'suspended' where phone = '+919999900003'"
   ```
4. Try to refresh, and to log out with the access token:
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/auth/refresh" -ContentType "application/json" -Body (@{ refreshToken = $t.refreshToken } | ConvertTo-Json)
   Invoke-RestMethod -Method Post -Uri "$api/auth/logout" -Headers @{ Authorization = "Bearer $($t.accessToken)" }
   ```
   **Expect:** both fail with 401 and `"code":"UNAUTHENTICATED"`.
5. Reactivate and log out:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "update app_user set status = 'active' where phone = '+919999900003'"
   Invoke-WebRequest -Method Post -Uri "$api/auth/logout" -Headers @{ Authorization = "Bearer $($t.accessToken)" } | Select-Object StatusCode
   ```
   **Expect:** `204` (the session was still open).
6. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "suspended users".

## Pass criteria

- Steps 4–6 give the expected results.

## Known issues and notes

- **No admin screen or endpoint for suspending yet**; that comes with user
  management (Epic 4/7). The check here is what makes a suspension take effect
  immediately once those exist.
- If request volume ever makes the per-request query a problem, a short Redis
  cache is the fallback the issue allows; it isn't needed now.
