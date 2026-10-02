# #226: One app for volunteers and voters: voter sign-in and Home

**Issue:** https://github.com/yskartheek/BoothConnect/issues/226 (epic #222)
**What changed:**

- **Sign-in:** the sign-in screen starts with **Booth volunteer / Voter**. Volunteers sign in as before.
- **Voter sign-in:**
  - **Voter ID (EPIC) number** and **Mobile number** (the one the booth volunteer has), then **Send code** and the code;
  - "We only show details to the person they belong to." and "This app is not run by the Election Commission.";
  - the code step says "If these details match your record, we sent a code to …": it never says whether they matched.
- **Voter Home:**
  - "Namaste, <name>";
  - **Your booth**: the polling station and its number, the part, the serial number on the roll, and the election;
  - pull to refresh; a sign-out button.
  - Online only: offline, it says "Connect to the internet to see your details." with **Try again**.
- A voter can't open volunteer screens, and a volunteer can't open the voter screens.
- Closing and reopening the app keeps the voter signed in. Signing out leaves nothing of the voter on the phone.
- My details, Updates and Privacy come in #227 and #228.

## Steps

1. Start the API with the development seed and codes, and the app on the emulator (see [SETUP.md](../SETUP.md) sections 2–4), with this branch: `claude/issue-226-voter-app-entry`. It includes the API changes from #223–#225, so run `pnpm --filter api db:deploy` first.
2. On the sign-in screen, tap **Voter**.
   **Expect:** **Voter ID (EPIC) number** and **Mobile number**, and the two notes underneath.
3. Type `DMO1000001` and `9999900101`, then **Send code**.
   **Expect:** "If these details match your record, we sent a code to +919999900101." The API window shows the code.
4. Type the code, then **Sign in**.
   **Expect:** "Namaste, …" and **Your booth**: "Demo Primary School, Room 1, booth 1", "Part 1 · Demo Nagar", "Serial 1 on the roll".
5. Close the app (recent apps, swipe away) and open it again.
   **Expect:** the voter Home again, without signing in.
6. Turn on airplane mode, then pull down on Home.
   **Expect:** "Connect to the internet to see your details." Turn airplane mode off and tap **Try again**: Home again.
7. Tap the sign-out button (top right).
   **Expect:** the sign-in screen.
8. Tap **Voter**, type `DMO1000002` (another voter) with `9999900101`, then **Send code**.
   **Expect:** the same "If these details match…" message, and no code in the API window.

## Pass criteria

- Steps 1–8 give the expected results.

## Known issues and notes

- A voter needs a mobile number on their record, added by their booth volunteer.
- Codes can be requested 3 times per phone and per voter ID in 10 minutes.
