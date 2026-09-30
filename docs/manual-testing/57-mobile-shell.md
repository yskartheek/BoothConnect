# #57: Mobile app shell: navigation, sign-in redirect, theme

**Issue:** https://github.com/yskartheek/BoothConnect/issues/57
**What changed:**

- **Routes** (go_router), one folder per feature under `lib/features/`:

  | Path                  | Screen                | Built in |
  | --------------------- | --------------------- | -------- |
  | `/sign-in`            | Sign in               | #60      |
  | `/`                   | Home                  | #62      |
  | `/households`         | Households            | #63      |
  | `/household/:id`      | Household             | #64      |
  | `/visit/:householdId` | Visit                 | #65      |
  | `/sync`               | Uploads (sync center) | #67      |

  Every screen except home is a placeholder: its title and "This screen is
  being built."

- **Sign-in redirect:** a signed-out volunteer is sent to sign-in from any
  page. After signing in, the app opens the page that was asked for (only a
  page of this app), or home. Signing out goes back to sign-in.
- **Sign-in is a placeholder** until OTP sign-in (#60). A development build
  shows **Continue (development build)**; a release build has no way past
  sign-in yet.
- Home has **Households** and **Uploads** buttons, and **Sign out** in the
  app bar.
- An unknown link shows "Page not found" with **Go to home**.
- The theme follows the phone's light or dark setting, and all text is in
  English and Telugu.

> **Since #60** the sign-in screen is real (a code sent by SMS), and the
> **Continue (development build)** button below is gone. To test these steps
> on a later branch, sign in as in the [#60 guide](60-mobile-sign-in.md).

## Steps

Set up Flutter and the Android emulator once, as in the
[#11 guide](11-mobile-skeleton.md) (Prerequisites).

1. Check out the branch and run the checks:
   ```powershell
   git checkout claude/issue-57-mobile-shell
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. Start the emulator, then run the app:
   ```powershell
   pnpm --filter mobile start
   ```
   **Expect:** the app opens on **Sign in**, with "Sign-in with a code sent
   to your phone is being built." and **Continue (development build)**.
3. Tap **Continue (development build)**.
   **Expect:** home: "Welcome to BoothConnect", with **Households** and
   **Uploads** buttons.
4. Tap **Households**.
   **Expect:** a screen titled **Households** that says "This screen is being
   built." Press the back arrow (or Android back).
   **Expect:** home again. Do the same with **Uploads**.
5. Tap the sign-out icon (top right; a long press shows "Sign out").
   **Expect:** back on **Sign in**. Android back doesn't return to home.
6. In the emulator settings, switch to dark mode, and back.
   **Expect:** the app switches theme as you do.
7. Set the emulator's language to Telugu (Settings → System → Languages).
   **Expect:** the sign-in screen is in Telugu ("సైన్ ఇన్").

## Pass criteria

- Steps 1–7 give the expected results.

## Known issues and notes

- Sign-in isn't real yet: the app starts signed out every time, and the
  development button stands in for OTP sign-in until #60.
- Opening a page from a link (for example `/household/h-1` while signed out,
  then returning to it after sign-in) is covered by the widget tests. Links
  from other apps aren't set up in the Android and iOS projects.
