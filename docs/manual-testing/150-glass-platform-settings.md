# #150: Glass follows the phone (reduce transparency, battery saver, low-end)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/150
**What changed:**

- The app now asks the phone whether glass should be solid, and updates
  straight away when you change the setting:
  - **iPhone:** Reduce Transparency, and Low Power Mode
  - **Android:** there is no "reduce transparency" setting, so the app checks
    whether Android currently allows blur (battery saver and some devices turn
    it off). **Battery saver** and phones Android marks as **low-RAM** also make
    glass solid
- When any of these is on, every `GlassSurface` (for now, the home screen
  card) becomes solid with no blur
- Builds on #55 (PR #148), so test that one first

## Steps

1. Check out the branch:
   ```powershell
   git checkout claude/issue-150-glass-platform-settings
   pnpm install --frozen-lockfile
   ```
2. Run the Flutter checks:
   ```powershell
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!` (14 tests). The test
   `app glass follows the phone reduce-transparency setting` covers this
   issue's acceptance criterion.
3. Start the Android emulator (API 31 or newer) and run the app:
   ```powershell
   pnpm --filter mobile start
   ```
   **Expect:** the home screen card looks like frosted glass: slightly
   see-through, no shadow.
4. Turn on battery saver. Pull down the quick settings and tap **Battery
   Saver** (or **Settings → Battery → Battery Saver → On**).
   **Expect:** within a second, the card becomes solid with a soft shadow.
   Turn battery saver off and the glass comes back.
5. Optional, iPhone or iOS simulator (needs a Mac): **Settings →
   Accessibility → Display & Text Size → Reduce Transparency**. Switch it on
   and off while the app is open.
   **Expect:** the card turns solid, then back to glass. Low Power Mode does
   the same.

## Pass criteria

- Step 2 passes.
- Step 4 (and step 5 if you have a Mac) switches the card between glass and
  solid without restarting the app.

## Known issues and notes

- **On a plain background the change is subtle.** Look for the card's shadow:
  it only appears when the card is solid.
- **The emulator may not allow blur at all.** If the card is already solid in
  step 3, the emulator reports that window blur is unavailable (common on
  emulators without GPU acceleration). This is the expected fallback. Try a
  real phone, or turn on **Settings → System → Developer options → Allow
  window-level blurs**.
- **Android 11 and older** have no blur setting to read, so only battery saver
  and low-RAM devices make glass solid there.
- **The iOS code wasn't built in CI or by Claude** (it needs a Mac). The
  Android code was compiled against the Android 14 SDK classes but not run on a
  device. Steps 4 and 5 are the first real run, so please report anything odd.
