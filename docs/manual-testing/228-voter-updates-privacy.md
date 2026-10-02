# #228: Voter app: Updates and Privacy (stop sharing a consent)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/228 (epic #222)
**What changed:**

- **Tabs:** the voter side now has **Home**, **My details**, **Updates** and **Privacy**.
- **Updates:**
  - what happened to your record, newest first: "You updated your mobile number", "Your booth volunteer updated your occupation", "Booth volunteer visited · No one home", "You started using the app". It never shows the values;
  - **Who has seen my details?**: your booth volunteer and the booth coordinator, and every view is logged.
- **Privacy:**
  - **Shared with your booth team**: each detail you share, with why;
  - **Shared with your consent**: details shared only with your consent (caste / community), when you agreed, and **Stop sharing**. It asks first, then stops. Your booth team no longer sees the detail, and it's removed from their phones;
  - **Sign out**.

## Steps

1. Start the API with the development seed and codes, and the app on the emulator (see [SETUP.md](../SETUP.md) sections 2–4), with this branch: `claude/issue-228-voter-updates-privacy`.
2. **Give a consent first.** In the app, sign in as the volunteer `+919999900002`. Open **Households**, **H NO 1-3**, and the first member. Under **Caste / community**, tick **Voter agrees to share this**, type `Synthetic community`, and **Save**. Wait for it to upload (**Sync** shows nothing waiting). Then sign out.
3. Sign in as the voter: **Voter**, `DMO1000001`, `9999900101`, **Send code**, the code from the API window, **Sign in**.
4. Tap **Updates**.
   **Expect:** **Who has seen my details?** with its note. Below it, the history, each line with a date: "You started using the app", and any changes from earlier testing (e.g. "You updated your occupation" from #227). No values are shown. The caste / community added in step 2 is **not** listed: restricted details never appear in Updates.
5. Tap **Privacy**.
   **Expect:**
   - **Shared with your booth team**: the mobile number, occupation and additional info, each with why;
   - **Shared with your consent**: **Caste / community**, "You agreed on …", and **Stop sharing**.
6. Tap **Stop sharing**, then **Keep sharing**.
   **Expect:** nothing changes.
7. Tap **Stop sharing**, then **Stop sharing** in the dialog.
   **Expect:** "Stopped sharing.", and the entry now says "You stopped sharing on …" without the button.
8. Turn on airplane mode, tap **Updates**, and pull down on it.
   **Expect:** "Connect to the internet to see your details." with **Try again**. Turn airplane mode off and tap **Try again**: the history again.
9. Sign out (the button at the bottom of **Privacy**), sign in as the volunteer `+919999900002`, tap **Sync**, then open **H NO 1-3** and the same member.
   **Expect:** no caste / community value.

## Pass criteria

- Steps 1–9 give the expected results.

## Known issues and notes

- The development seed has no consent for the demo voter, so step 2 adds one. #229 adds one to the seed.
- "Who has seen my details?" says who can see them. A list of each view comes later.
- If a consent is withdrawn, the volunteer has to ask again to record that detail. A withdrawn consent can't be reused.
