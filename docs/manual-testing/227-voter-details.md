# #227: Voter app: My details, and editing what the voter shares

**Issue:** https://github.com/yskartheek/BoothConnect/issues/227 (epic #222)
**What changed:**

- **Tabs:** the voter side has **Home** and **My details** at the bottom.
- **My details:**
  - **From the electoral roll** (marked **Official**): name, age · gender, voter ID, part · serial, booth. The app can't change these. A note says official corrections are made with the Election Commission (Form 8).
  - **Details you share**: mobile number, occupation, additional info. A missing one says "Not added". "Shared with your booth team only."
- **Edit my details** (the **Edit** button):
  - only changed details are sent; the mobile number is checked and saved as +91…;
  - "Saved." when it worked; if someone else changed a detail meanwhile, it says which and shows theirs;
  - offline, it says to connect and keeps what you typed.
- **Home** shows **Check your details** while a detail is missing, with **Add**.
- Updates and Privacy come in #228.

## Steps

1. Start the API with the development seed and codes, and the app on the emulator (see [SETUP.md](../SETUP.md) sections 2–4), with this branch: `claude/issue-227-voter-details`. Run `pnpm --filter api db:deploy` first.
2. Sign in as a voter: **Voter**, `DMO1000001`, `9999900101`, **Send code**, the code from the API window, **Sign in**.
   **Expect:** Home, with **Check your details** ("Additional info not added yet") and **Add**.
3. Tap **My details** at the bottom.
   **Expect:** **From the electoral roll** with **Official**, the name, age · gender, `DMO1000001`, part · serial, the booth, and the Form 8 note. Under **Details you share**: `+919999900101`, an occupation, and "Not added" for Additional info.
4. Tap **Edit**. Change **Occupation** to `Farmer`, type `Lives near the school` in **Additional info**, then save (✓ top right).
   **Expect:** "Saved.", back on **My details** with `Farmer` and `Lives near the school`.
5. Tap **Home**.
   **Expect:** no **Check your details** card any more.
6. Tap **My details**, **Edit**, type `12345` in **Mobile number**, and save.
   **Expect:** "Enter a 10-digit mobile number, or + and the country code." Nothing is saved.
7. Still on the form, turn on airplane mode, change **Occupation** to `Teacher`, and save.
   **Expect:** "Connect to the internet to see your details."; still on the form with `Teacher`. Turn airplane mode off.
8. Put the mobile number back to `9999900101` and save.
   **Expect:** "Saved." and `Teacher`.
9. In the web admin (signed in as the admin, see SETUP.md), open the same voter.
   **Expect:** occupation `Teacher` and the additional info you typed.

## Pass criteria

- Steps 1–9 give the expected results.

## Known issues and notes

- Changing the mobile number changes the number you sign in with (the form says so). If you change it in step 8, sign in with the new number next time.
- Emptying a detail and saving leaves it as it was: details can be changed, not removed.
- The admin shows these values without a "Shared by the voter" label yet (#229).
