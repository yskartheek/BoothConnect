# #64: Mobile household screen: address, members, Start visit

**Issue:** https://github.com/yskartheek/BoothConnect/issues/64
**What changed:**

- Tapping a household in **Households** opens its screen, read from the phone's own database. It has three blocks:
  - **The address card:**
    - the address, then area · landmark · PIN code;
    - a small map preview when a location is saved;
    - "Last visit 26 Sep · Come back later" or "Not visited yet";
    - the upload chip (**Uploaded**, **On phone**, **Choose value**).
  - **Members · N:** one card per member, with initials, name, and age · gender · occupation. The latest correction wins over the roll. Members added by volunteers come last.
  - **Start visit:** a floating button on Android, a full-width button at the bottom on iOS.
- **Edit** (header), **Add member** and tapping a member open their screens. These are placeholders until #115 (address) and #114 (member details).
- Fields the admin has turned off (for example occupation) are never shown.
- The map preview is drawn on the phone. It loads no map tiles, so the household's position isn't sent anywhere, and it works offline.
- "Household not found" shows for a household that's no longer on the roll.
- All text is in English and Telugu.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-64-household-screen
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. On the emulator with the API running and the development seed loaded (see the [#60 guide](60-mobile-sign-in.md)), sign in as `+919999900002` (Demo Volunteer A). Open **Households** and tap **H NO 1-3**.
   **Expect:**
   - "H NO 1-3", then "Demo Nagar · 500001";
   - a map preview with a pin, which TalkBack reads as "Location saved, accurate to 8 m";
   - "Not visited yet".
3. Look at **Members**.
   **Expect:**
   - "Members · _N_" matches the number of cards;
   - the first member shows an occupation;
   - the member added by a volunteer (surname Demoreddy, 19 · Female) is last.
4. Tap **Edit**, then back. Tap **Add member**, then back. Tap a member, then back. Tap **Start visit**, then back.
   **Expect:** "Address", "Add member", "Member" and "Visit" in turn; back returns to the household each time.
5. Open a household without a saved location (e.g. **H NO 1-12**).
   **Expect:** no map preview.
6. Optional: turn off the occupation field in the development database (set `enabled` to false on the `field_definition` row with key `occupation`). Then pull down on **Households** and reopen the household.
   **Expect:** no occupation on any card.
7. Optional, on an iPhone simulator: **Start visit** is a full-width button at the bottom, with no floating button.
8. Optional: switch the phone to Telugu.
   **Expect:** "సభ్యులు · _N_", genders in Telugu, and "సందర్శన ప్రారంభించండి".

## Pass criteria

- Steps 1–5 give the expected results.

## Known issues and notes

- The address, add member, member details and visit screens are placeholders until #115, #114 and #65.
- The map preview is a drawing, not a real map. Showing real map tiles would send the household's location to a map provider, which needs a decision (provider, terms, consent notice) first.
