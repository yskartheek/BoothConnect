# #70: Admin sign-in (code, MFA placeholder, admins only)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/70
**What changed:**

- The admin portal needs sign-in. `/sign-in` asks for the phone number,
  then the 6-digit code.
- Only admins get in. Anyone else, e.g. a volunteer, sees "No access" and is
  not signed in.
- After the code comes a two-step verification page. It is a placeholder
  that lets admins through in development.
- The sign-in tokens are kept by the portal's server in httpOnly cookies.
  Page scripts can't read them.
- The portal's pages call the API through the portal's server, which adds
  the token and renews it when it expires. "Sign out" in the top bar ends
  the session.

Use the development seed's synthetic accounts only.

## Steps

1. Start the API with development codes, and the admin web:
   ```powershell
   pnpm infra:up
   pnpm --filter api db:deploy
   pnpm --filter api db:seed
   $env:OTP_DEV_MODE = "true"; pnpm --filter api dev
   ```
   In a second window:
   ```powershell
   pnpm --filter admin-web dev
   ```
2. Open http://localhost:3000/audit.
   **Expect:** you are sent to the sign-in page, and the address ends with
   `/sign-in?next=%2Faudit`.
3. Enter `+919999900001` (the seed admin) and click **Send code**. Copy the
   code from the API window (`Development sign-in code for +919999900001: …`),
   enter it and click **Sign in**.
   **Expect:** the "Two-step verification" page.
4. Click **Continue**.
   **Expect:** "Audit and security" opens, with "Demo Admin" and **Sign
   out** in the top bar.
5. Open the browser's developer tools, go to **Application → Cookies →
   http://localhost:3000**, and in the Console run `document.cookie`.
   **Expect:**
   - the cookies `bc_access`, `bc_refresh`, `bc_mfa` and `bc_device` all have
     **HttpOnly** ticked;
   - `document.cookie` is `""`: scripts can't see them.
6. Delete the `bc_access` cookie in developer tools, then click **Users and
   assignments**.
   **Expect:** the page opens and "Demo Admin" is still shown. The token was
   renewed, and a new `bc_access` cookie appears.
7. Click **Sign out**.
   **Expect:** the sign-in page. Opening http://localhost:3000/ sends you
   back to sign-in.
8. Sign in as the seed volunteer, `+919999900002`, with its code.
   **Expect:** "No access" and "This portal is for admins…". There is no
   `bc_access` cookie, and http://localhost:3000/ goes back to sign-in.
9. Enter a wrong code for the admin.
   **Expect:** "That code is wrong or has expired."
10. Run the tests:
    ```powershell
    pnpm --filter admin-web test
    pnpm --filter admin-web test:e2e
    ```
    **Expect:** 53 component and server tests, and 16 browser tests, pass.
    The browser tests use a stand-in for the API, so the API isn't needed
    for them.

## Pass criteria

- Steps 2–10 give the expected results.

## Known issues and notes

- The two-step verification is a placeholder: nothing is checked yet. On a
  production build it is closed unless `ADMIN_MFA_STUB=allow` is set (test
  deployments only).
- If the API runs somewhere other than http://localhost:4000, set `API_URL`
  in `apps/admin-web/.env.local`.
