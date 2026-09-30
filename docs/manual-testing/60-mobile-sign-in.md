# #60: Mobile sign-in with a code, and the API client

**Issue:** https://github.com/yskartheek/BoothConnect/issues/60
**What changed:**

- **Sign-in:**
  - enter your mobile number (10 digits, or with `+` and the country code)
    and tap **Send code**;
  - enter the 6-digit code and tap **Sign in**;
  - the app then checks you have a volunteer assignment. Someone without one
    (an admin, for example) sees "No access" and isn't signed in.
- Wrong codes, too many attempts and no connection each get a clear message.
  Development builds say where the code is (the API's log).
- The app remembers the sign-in: reopening it goes straight to home.
- **Behind the scenes:**
  - the tokens are in the phone's secure storage;
  - every call has a request id;
  - an expired access token is renewed once and the call retried, and
    several calls at once share one renewal, so the server doesn't end the
    session;
  - if the renewal is refused, the app asks you to sign in again and keeps
    its data.
- **Sign out** ends the session and wipes the phone's data (#59).
- Android debug builds may use plain http to reach the API on your computer.
  Release builds need https.

## Steps

Set up Flutter and the emulator as in the [#11 guide](11-mobile-skeleton.md),
and the API as in the [#29 guide](29-otp-sign-in.md) with
`OTP_DEV_MODE=true`, so codes are written to the API's log.

1. Run the checks:
   ```powershell
   git checkout claude/issue-60-otp-sign-in
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. Start the API (with the demo seed data) and the emulator, then run the app.
   From the emulator, the computer is `10.0.2.2`, which is the default:
   ```powershell
   pnpm --filter api dev
   pnpm --filter mobile start
   ```
   To use another API, add
   `--dart-define=API_BASE_URL=http://<address>:4000` to `flutter run`.
3. Enter `99999 00002` (the synthetic **Demo Volunteer A**) and tap **Send
   code**.
   **Expect:** "We sent a 6-digit code to +919999900002." In the API's
   terminal:
   `Development sign-in code for +919999900002: <code>`.
4. Enter `000000` and tap **Sign in**.
   **Expect:** "That code is wrong or has expired."
5. Enter the code from the API's terminal and tap **Sign in**.
   **Expect:** the home screen.
6. Close the app completely and open it again.
   **Expect:** home, without signing in.
7. Tap the sign-out icon.
   **Expect:** back on sign-in.
8. Sign in as `+919999900161` (the synthetic **Test Records Admin**, an admin
   with no volunteer role).
   **Expect:** "No access" and "This app is for volunteers assigned to a
   booth. …". Tap **Use another number**.
9. Stop the API and tap **Send code**.
   **Expect:** "Can't reach the server. Check your connection and try again."

## Pass criteria

- Steps 1 and 3–9 give the expected results.

## Known issues and notes

- The number check is for Indian mobiles (10 digits starting 6–9); other
  countries need `+` and the country code.
- A refused renewal (for example, after the session was revoked on the
  server) brings back sign-in but keeps the phone's data. Only **Sign out**
  wipes it.
- Too many code requests in a short time are refused by the API ("Too many
  attempts…"). Wait a few minutes.
