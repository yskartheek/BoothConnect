# #79: SETUP.md with run commands for every app

**Issue:** https://github.com/yskartheek/BoothConnect/issues/79
**What changed:** [`docs/SETUP.md`](../SETUP.md) now covers everything needed to run and test BoothConnect on Windows. New sections:

- **Seed data and signing in:** the demo geography, the three seed users (admin, volunteer A, volunteer B) with what each can see, and where the development sign-in code appears.
- **Demo: an offline visit, synced:** step by step on the Android emulator. Sign in, go offline, record a visit, restart the app, go back online, and find the visit in the admin web's audit log.
- **Running each app:** the API (development and built), the roll-parser worker, the admin web, and the mobile app on the emulator and on a real phone (`adb reverse` or the computer's Wi-Fi address), plus `admin:grant` and `stats:rebuild`.
- **Tests:** every suite with its command and what it needs, and how to leave out mobile and the roll parser.
- **Troubleshooting** for WSL 2 and Docker Desktop, Windows' reserved port ranges, and the Android emulator reaching the API.

## Steps

Ideally on a Windows machine that hasn't run BoothConnect before, or by someone who hasn't seen the repo:

1. Follow `docs/SETUP.md` from the top: sections 1 and 2.
   **Expect:** http://localhost:4000/v1/health shows `"status": "ok"`.
2. Follow section 4, **Demo: an offline visit, synced**, steps 1–9.
   **Expect:** each step's **Expect**; at the end, a `visit.create` event by Demo Volunteer A in the admin web's **Audit** page.
3. From section 6, run the API unit tests and the mobile tests:
   ```powershell
   pnpm --filter api test
   pnpm --filter mobile test
   ```
   **Expect:** both pass.
4. Note anything unclear or missing, and where you got stuck.

## Pass criteria

- Steps 1–3 work using only `docs/SETUP.md`.

## Known issues and notes

- Codes can be requested 3 times per phone in 10 minutes. Repeating the demo quickly gives "Too many attempts": wait, or sign in as Demo Volunteer B (`+919999900003`).
- The first `pnpm --filter mobile start` takes several minutes (Gradle and the SQLCipher download).
