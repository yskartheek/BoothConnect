# #115: Mobile household address, one-tap location and Add household

**Issue:** https://github.com/yskartheek/BoothConnect/issues/115
**What changed:**

- **Edit** on a household opens **Address**:
  - **House no.**, **Street**, **Area / locality**, **PIN code** and **Landmark**, filled in from the phone;
  - **Save** (a text button on iOS, a check on Android).
- **Checks on Save:** the PIN code is 6 digits (or empty), and at least one part of the address is filled in.
- **Location** card:
  - a drawn preview (no map is downloaded), "Accurate to about 8 m · captured …" and **Saved** when the household has a location;
  - **The household agrees to store its location**: **Use my current location** works only once it's ticked;
  - the button asks for the location permission the first time and takes **one** reading. The app never tracks the volunteer;
  - a new reading shows **Not saved yet** until **Save**;
  - a clear message if the permission is refused, blocked (with **Open settings**), location is off, or no reading comes.
- **Save** works offline: the household shows the new address and **On phone**, then **Uploaded**.
- **Add household** on the Households list opens the same form, empty, and adds a household that isn't on the official list. A house number already on the list is refused.
- **Uploads** lists these as "Address · …" and "New household · …".
- The location permission text explains the purpose for the app stores (Android and iOS).
- All text is in English and Telugu.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-115-household-address
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. On the emulator with the API running and the development seed loaded (see the [#60 guide](60-mobile-sign-in.md)), sign in as `+919999900002` (Demo Volunteer A). Open **Households**, tap a household, then **Edit**.
   **Expect:** **Address**, with the house number, street, area and PIN code filled in.
3. Type the PIN code `5000` and tap **Save**.
   **Expect:** "Enter a 6-digit PIN code.", and the screen stays open.
4. In the emulator's extended controls, set a location (**Location**, any point). Turn on **airplane mode**. Fix the PIN code and type a landmark.
5. Check that **Use my current location** is greyed out. Tick **The household agrees to store its location**, then tap **Use my current location**.
   **Expect:**
   - the first time, the permission prompt: choose **While using the app**;
   - the preview, "Accurate to about … m · captured …" and **Not saved yet**.
6. Tap **Save**.
   **Expect:** "Saved. It uploads when you're online."; the household shows the new landmark and PIN code, the map preview, and **On phone**.
7. Open **Edit** again and tap **Use my current location** after ticking the agreement, but deny the permission this time (first reset it: **Settings → Apps → BoothConnect → Permissions → Location → Ask every time** or **Don't allow**).
   **Expect:** "Location permission was refused…" (or, if blocked, "Location is blocked for this app…" with **Open settings**). Go back without saving.
8. Back on **Households**, tap **Add household**. Tap **Save** with nothing filled in, then type an existing house number (say `1-15`) and a street and **Save**.
   **Expect:** "Enter at least one part of the address.", then "A household with this house number is already on the list."
9. Change the house number to `SYN-1`, **Save**.
   **Expect:** "Household added…", the new household's screen with "SYN-1, …" and **On phone**; it is also on the Households list.
10. Turn airplane mode off.
    **Expect:** within a few seconds both households show **Uploaded**; in the admin portal the new household and the changed address and location are there.

## Pass criteria

- Steps 1–10 give the expected results.

## Known issues and notes

- The map preview is drawn on the phone: no map is downloaded, so the location isn't sent to a map provider and it works offline.
- An emptied address part is removed: the address is saved as a whole.
- A household edited after its creation was sent but before the next download is sent without a base, so the server reports a conflict to choose in **Uploads**. A download normally follows an upload within seconds.
