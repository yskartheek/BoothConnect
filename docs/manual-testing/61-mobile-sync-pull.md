# #61: Mobile sync pull: the booth's data on the phone

**Issue:** https://github.com/yskartheek/BoothConnect/issues/61
**What changed:**

- After sign-in, the app downloads your booth's data into its encrypted
  database: households, voters, collected values, field definitions and
  visits.
- It downloads again:
  - when you open the app with a stored sign-in;
  - when you come back to the app;
  - when the phone is back online.

  Later screens add pull-to-refresh.

- Downloads come in pages. Each page is saved whole, with its place in the
  download, so an interrupted download goes on where it stopped. After the
  first time, only what changed is downloaded.
- Values whose consent was withdrawn are removed from the phone.
- If someone else signs in on the same phone (after a session ended without
  **Sign out**), the previous volunteer's data is wiped first.
- Screens read only the phone's database, so they work offline. The
  household and member screens come in #63 and #64.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-61-sync-pull
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. Run the sync tests with their names:
   ```powershell
   cd apps/mobile
   flutter test test/data/sync_repository_test.dart test/features/sync_test.dart --reporter expanded
   ```
   **Expect:** among others,
   - "the first pull fills the database, page by page";
   - "a delta pull updates only the changed rows";
   - "an interrupted snapshot goes on where it stopped";
   - "another volunteer's data is wiped when someone else signs in";
   - "coming back online pulls".
3. Optional, on the emulator with the API running (see the
   [#60 guide](60-mobile-sign-in.md)): sign in as `+919999900002` (Demo
   Volunteer A).
   **Expect:** right after sign-in, the API's terminal shows
   `GET /v1/sync/pull` requests.

   Switch to another app and back.
   **Expect:** another `GET /v1/sync/pull`.

## Pass criteria

- Steps 1–2 pass.

## Known issues and notes

- No screen shows the downloaded data yet. The households list (#63) is the
  first.
- If the API restarts a full download partway (because your booths changed
  during it), rows from the first attempt may stay until the next full
  download.
