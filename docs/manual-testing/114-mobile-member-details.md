# #114: Mobile member details: every editable field, caste behind consent

**Issue:** https://github.com/yskartheek/BoothConnect/issues/114
**What changed:**

- Tapping a member on the household screen (or **Edit** in a visit) opens their details:
  - the member's name as the title, and **Save** (a text button on iOS, a check on Android);
  - under it, "Official list: _EPIC_ · Booth _n_" when the member is on the roll;
  - **Name**, **Age**, **Gender** (Female / Male / Third gender), **Mobile number**, **Occupation**, and **Additional info** (with "Don't record health, religion or party details here.");
  - **Caste / community (optional)**, marked **Sensitive**: the notice, then **Voter agrees to share this**. The field appears only once that's ticked.
- **Save:**
  - writes only what changed on the phone and queues it for upload (works offline);
  - checks the name isn't empty, the age is 0–130, and the mobile is a 10-digit number or + and the country code;
  - the household then shows **On phone**, and **Uploaded** once uploaded.
- **Caste / community** is recorded with the voter's consent: a consent record first (purpose `caste_community`, notice version `2026.1`, given in person), then the value.
  - The value is never kept on the phone. After saving, the card says "Recorded on this phone. After it uploads, only authorised staff can see it."
  - Downloads drop restricted details too, even if the server sends them.
- **Add member** on the household screen opens the same screen, empty, and adds someone who isn't on the official list.
- Fields the admin turned off are never shown. A field with a list of choices shows them as a list.
- Edits that aren't uploaded yet show in the visit form ("Updated occupation"), and conflicts with someone else's edit appear in **Uploads → Choose which value to keep**.
- All text is in English and Telugu.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-114-member-details
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. On the emulator with the API running and the development seed loaded (see the [#60 guide](60-mobile-sign-in.md)), sign in as `+919999900002` (Demo Volunteer A). Open **Households**, tap **H NO 1-3**, then a member.
   **Expect:** their name as the title, "Official list: …", and their details filled in from the roll (and any corrections).
3. Clear the name and tap **Save**.
   **Expect:** "Enter the name." Type an age of 200: "Enter an age from 0 to 130." Type the mobile `12345`: the mobile number message.
4. Turn on **airplane mode**. Fix the name, set the age to a valid number, change the occupation and choose **Female**, then **Save**.
   **Expect:** "Saved. It uploads when you're online."; the household shows the new details and **On phone**.
5. Open the member again. In **Caste / community**, check that the field isn't there; tick **Voter agrees to share this**, type a value, **Save**. Open the member again.
   **Expect:** "Recorded on this phone…", with no value shown.
6. On the household, tap **Add member**. Save with an empty name (refused), then enter a name, age 21, **Female**, an occupation, and **Save**.
   **Expect:** back on the household, "Members · _N+1_", and the new member's card.
7. Turn airplane mode off.
   **Expect:** within a few seconds the household shows **Uploaded**; in the admin portal the member and the changes are there, and the caste value only with its consent.

## Pass criteria

- Steps 1–7 give the expected results.

## Known issues and notes

- An emptied detail keeps its value: the API takes values, not removals.
- The server still sends a consented caste value back to the volunteer who recorded it; the phone drops it. Stopping it on the server (for volunteers) is a separate API change.
