# #59: Mobile encrypted local database

**Issue:** https://github.com/yskartheek/BoothConnect/issues/59
**What changed:**

- The app has a local database (Drift on **SQLCipher**) for the volunteer's
  booths:
  - households, voters, field values, field definitions and visits, as the
    API's sync pull sends them;
  - the sync cursor;
  - `pending_mutation`, the queue of changes waiting to upload.
- **Encryption:** a random 256-bit key is made on first launch and kept in
  the phone's secure storage (Android Keystore / iOS Keychain). Without that
  key the file is unreadable: no SQLite header, no readable text.
- **Sign-out wipes the phone:** the database files and the key are deleted.
- **Migrations:** each schema version has its own step. Queued changes are
  never dropped, and an older app refuses a newer database.
- CI now checks that Drift's generated code (`app_database.g.dart`) is up to
  date.

No screen stores data yet (sync pull is #61), so this issue is checked
through the tests.

## Steps

1. Check out the branch and run the checks:
   ```powershell
   git checkout claude/issue-59-encrypted-db
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`. The first run
   downloads the SQLCipher library for your computer (needs internet access
   to GitHub).
2. Run the database tests on their own:
   ```powershell
   cd apps/mobile
   flutter test test/data/local_store_test.dart --reporter expanded
   ```
   **Expect:** among others,
   - "the file can't be opened without the key": the file has no SQLite
     header, the synthetic address can't be found in its bytes, and opening
     it without the key or with another key fails;
   - "wipe removes the data and the key".
3. Check the generated code is current:
   ```powershell
   pnpm --filter mobile generate
   git status
   ```
   **Expect:** no changes.
4. Optional, on the emulator: run the app (`pnpm --filter mobile start`),
   tap **Continue (development build)**, then sign out.
   **Expect:** back on sign-in, with no error.

## Pass criteria

- Steps 1–3 pass.

## Known issues and notes

- The app opens the database when a screen first needs it (from #61), so on
  the emulator there's no file to look at yet.
- Until #60, the app starts signed out on every launch. Sign-out already
  wipes the database and key.
