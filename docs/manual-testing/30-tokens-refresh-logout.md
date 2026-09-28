# #30: Access tokens, refresh rotation and logout

**Issue:** https://github.com/yskartheek/BoothConnect/issues/30
**What changed:**

- **Every API endpoint now needs a valid access token**
  (`Authorization: Bearer …`), except the ones that must work before
  signing in: `/v1/health`, the two sign-in endpoints and refresh. Without a
  valid token the API answers 401 `UNAUTHENTICATED`.
- An access token only works while its session is open: after logout, or
  once the session has expired, it gets 401 even if it hasn't expired yet.
- `POST /v1/auth/refresh` exchanges the refresh token for a new pair. The old
  refresh token stops working. **If an old refresh token is used again**, the
  API assumes it was copied and **ends the whole session**, so whoever holds
  it (and the real device) must sign in again.
- `POST /v1/auth/logout` signs out the current device only. The user's other
  devices stay signed in.
- For developers: `loginAs(...)` in the API tests signs a test user in
  directly.

## Steps

1. Check out the branch, install, and prepare as for #29:
   ```powershell
   git checkout claude/issue-30-tokens
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   pnpm --filter api db:seed
   pnpm --filter api dev
   ```
   Keep `OTP_DEV_MODE=true` in `.env`.
2. In a second PowerShell window, sign in as the demo admin (the code is in
   the API window's log; replace `123456`):
   ```powershell
   $api = "http://localhost:4000/v1"
   Invoke-WebRequest -Method Post -Uri "$api/auth/otp/request" -ContentType "application/json" -Body '{"phone":"+919999900001"}' | Select-Object StatusCode
   $t1 = Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType "application/json" -Body '{"phone":"+919999900001","code":"123456","deviceId":"my-laptop"}'
   ```
3. Call a protected endpoint without a token:
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/auth/logout"
   ```
   **Expect:** 401 with `"code":"UNAUTHENTICATED"`.
4. Refresh:
   ```powershell
   $t2 = Invoke-RestMethod -Method Post -Uri "$api/auth/refresh" -ContentType "application/json" -Body (@{ refreshToken = $t1.refreshToken } | ConvertTo-Json)
   $t2.refreshToken -ne $t1.refreshToken
   ```
   **Expect:** `True` (a new refresh token).
5. Use the **old** refresh token again:
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/auth/refresh" -ContentType "application/json" -Body (@{ refreshToken = $t1.refreshToken } | ConvertTo-Json)
   ```
   **Expect:** 401. The session is now ended, so even the new tokens fail:
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$api/auth/refresh" -ContentType "application/json" -Body (@{ refreshToken = $t2.refreshToken } | ConvertTo-Json)
   ```
   **Expect:** 401 again.
6. Sign in again (repeat step 2, with a new code), then log out:
   ```powershell
   Invoke-WebRequest -Method Post -Uri "$api/auth/logout" -Headers @{ Authorization = "Bearer $($t1.accessToken)" } | Select-Object StatusCode
   ```
   **Expect:** `204`. Running the same command again gives 401: the token no
   longer works after logout.
7. Check health still works without a token:
   ```powershell
   Invoke-RestMethod "$api/health"
   ```
   **Expect:** `status` `ok`.
8. Run the tests:
   ```powershell
   pnpm --filter api test
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "access tokens, refresh rotation and
   logout".

## Pass criteria

- Steps 3–7 give the expected results and step 8 passes.

## Known issues and notes

- **Suspended users** can still use a token until it expires (up to 15
  minutes); #31 checks the user's status on every request.
- **Two refreshes at the same moment** with the same token (for example a
  retry after a network hiccup) count as reuse and end the session. The app
  will send one refresh at a time (Epic 6).
- `GET /v1/me` (who am I, my booths) comes in #32.
