# #68: Mobile end-to-end test: offline visit → restart → reconnect → synced

**Issue:** https://github.com/yskartheek/BoothConnect/issues/68
**What changed:**

- A new test, `apps/mobile/test/e2e/offline_sync_test.dart`, covers the mobile row of the plan's §8 test table: "Queue survives app restart; offline visit → reconnect → synced state". It runs the whole app as on a phone:
  1. Sign in through the screen, and download the booth.
  2. Go offline, and record a visit (**No one home**).
  3. Close the app and open it again on the same encrypted database: still signed in, and the visit is still waiting ("Offline · 1 waiting").
  4. Come back online: the visit uploads at once, stored once under the phone's key, and the household shows **Uploaded**.
- **How it runs:**
  - It uses the app's real HTTP client, against a stand-in API on localhost (`test/support/fake_api_server.dart`).
  - That server follows the API's rules: an `Idempotency-Key` on each push, and each change stored once.
  - Offline means the phone's connection is off and the server drops every connection.
  - It runs with `flutter test`, so CI's Mobile job runs it on every change; no emulator is needed.
- **Fixed, found by this test:** coming back online now uploads waiting changes at once. Before, a change waiting out its retry delay (up to 5 minutes) wasn't sent until that delay was over, even though the phone was back online.

## Steps

1. Run the test:
   ```powershell
   git checkout claude/issue-68-e2e-offline
   pnpm install --frozen-lockfile
   cd apps/mobile
   flutter test test/e2e/offline_sync_test.dart
   ```
   **Expect:** `All tests passed!` (it takes a few seconds).
2. Run everything:
   ```powershell
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
3. Optional, on the emulator against the real API: the steps of the [#66 guide](66-mobile-sync-push.md), steps 3–6 (record a visit in airplane mode, close the app, reopen, turn airplane mode off).
   **Expect:** as there.

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- This is a Flutter widget test running the full app, not a Flutter `integration_test` on a device or emulator. That keeps it fast and in the existing CI job. The phone-specific parts it doesn't exercise (secure storage, the connectivity plugin, the app lifecycle) are covered by the manual guides (#59, #61, #66).
