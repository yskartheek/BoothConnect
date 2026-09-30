# #62: Mobile home screen: booth, visits and uploads

**Issue:** https://github.com/yskartheek/BoothConnect/issues/62
**What changed:**

- Home shows, from the phone's own database:
  - **Your booth:** for example "Demo Primary School, booth 1";
  - **Visits:** "3 of 10 households visited", with a progress bar;
  - **Uploads:** "Waiting to upload: 2" with a badge, or "Everything is
    uploaded.", and when the booth data was last downloaded.
- "You're offline" shows at the top while there's no connection.
- Pull down to download the booth's latest data.
- **Households** and **Uploads** lead to their screens.
- All text is in English and Telugu.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-62-home-screen
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. On the emulator with the API running (see the
   [#60 guide](60-mobile-sign-in.md)), sign in as `+919999900002` (Demo
   Volunteer A).
   **Expect:**
   - "Your booth" shows Demo Volunteer A's polling station;
   - "0 of N households visited", where N is the number of households in
     that booth;
   - "Everything is uploaded." and "Booth data updated" with today's date
     and time.
3. Pull the screen down.
   **Expect:** "Downloading booth data…", then "Booth data updated" with the
   new time.
4. Turn on airplane mode.
   **Expect:** "You're offline" at the top. Turn it off: the banner goes.
5. Tap **Households**, then back; tap **Uploads**, then back.
   **Expect:** each screen opens, and back returns home.

## Pass criteria

- Steps 1–5 give the expected results.

## Known issues and notes

- Visits and queued changes appear once recording a visit is built (#65,
  #66); until then, visits come only from the server, and "Waiting to
  upload" stays at 0.
