# #67: Mobile Uploads screen: queue status, Choose value, retry

**Issue:** https://github.com/yskartheek/BoothConnect/issues/67
**What changed:**

- **Uploads** (from the Uploads button on Home) shows what's on the phone and not on the server yet.
- **Top card:**
  - online or offline, and "uploading 1 of 3", "2 waiting" or "everything uploaded";
  - a line explaining that saves stay on the phone and upload by themselves;
  - **Upload now** (sends everything waiting, without waiting for the next try).
- **Choose which value to keep:** when two people changed the same detail while offline, a card shows:
  - whose detail it is (member or household), which detail, and the address;
  - both values, each with who made it ("Yours", or their name) and when, as radio choices; your own value is chosen first;
  - **Keep selected value**: the choice is saved on the phone and uploads. The other value stays in the history; nothing is discarded silently, and nothing goes to a reviewer.
- **Waiting to upload:** each change (e.g. "Visit · 12/4 Gandhi Road", "Occupation · 12/4 Gandhi Road") with **Uploading now**, **Next try at 10:07 AM**, or **Waiting for the connection**.
- **Not uploaded:** changes the server refused, with the reason, what to do, and **Retry**.
- Downloads now keep both values of every open conflict, so the choice can be made on the phone.
- All text is in English and Telugu.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-67-uploads-screen
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. Start the API with the development seed (see the [#60 guide](60-mobile-sign-in.md)). On the emulator, sign in as `+919999900002` (Demo Volunteer A). On Home, tap **Uploads**.
   **Expect:** "Online · everything uploaded" and "Nothing is waiting…".
3. Turn on **airplane mode**. Record a visit (**No one home**) on any household, then open **Uploads**.
   **Expect:** "Offline · 1 waiting", and "Visit · _address_" with "Waiting for the connection" (or a next-try time) and **On phone**.
4. Turn airplane mode off and tap **Upload now**.
   **Expect:** within a few seconds, "Online · everything uploaded".
5. Optional: in airplane mode, change a member's mobile number on the phone. Meanwhile, change the same number on another phone or in the admin portal. Turn airplane mode off.
   **Expect:**
   - **Choose which value to keep**, with both numbers, "Yours · …" and the other person's name;
   - choose one and tap **Keep selected value**: "Kept…", the card goes, and the household no longer shows **Choose value**.

## Pass criteria

- Steps 1–4 give the expected results.

## Known issues and notes

- Refused changes are covered by the widget and in-app tests (`uploads_test.dart`), not these steps.
- The time shown for a value is the phone's local time.
