# #11: Flutter mobile skeleton

**Issue:** https://github.com/yskartheek/BoothConnect/issues/11
**What changed:**

- New Flutter app `apps/mobile` (Dart package `boothconnect_mobile`, Android
  and iOS, application ID `org.boothconnect.boothconnect_mobile`), built with
  Flutter 3.47 stable
- A placeholder home screen with Riverpod, go_router and localized strings
  (`lib/l10n/app_en.arb`), with light and dark themes that follow the system
- Strict analysis: `strict-casts`, `strict-inference`, `strict-raw-types`
  and about 25 extra lint rules on top of `flutter_lints`
- Dependencies from the issue: flutter_riverpod, go_router, drift,
  flutter_secure_storage, dio, connectivity_plus, flutter_localizations (+
  intl). **SQLCipher** is set up differently from the issue's
  `sqlcipher_flutter_libs`; see the notes.
- One widget test, and pnpm scripts, so `pnpm lint` and `pnpm test` at the
  repo root now include the mobile app

## Prerequisites (one time)

1. Install the Flutter SDK (stable) for Windows:
   https://docs.flutter.dev/get-started/install/windows/mobile
2. Install Android Studio, and in its SDK Manager install an Android SDK,
   the **Android SDK Command-line Tools** and an emulator image. Create a
   virtual device in **Device Manager**.
3. Accept the Android licenses and check your setup:
   ```powershell
   flutter doctor --android-licenses
   flutter doctor
   ```
   **Expect:** green ticks for Flutter, Android toolchain and Android Studio.
   (Visual Studio and Chrome aren't needed for this app.)

## Steps

1. Check out the branch and install:
   ```powershell
   git checkout claude/issue-11-mobile-skeleton
   pnpm install --frozen-lockfile
   ```
2. Run the checks:
   ```powershell
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` from lint, and `All tests passed!` from
   test. The first run downloads the Dart packages.
3. Start the Android emulator from Android Studio (Device Manager → ▶), then:
   ```powershell
   flutter devices                  # the emulator should be listed
   pnpm --filter mobile start
   ```
   **Expect:** the first build takes a few minutes (Gradle and the SQLCipher
   library are downloaded). Then the app opens on the emulator with an app bar
   titled **BoothConnect**, the heading "Welcome to BoothConnect" and the
   text "Sign-in and your assigned households will appear here."
4. With the app running, press `r` in the terminal (hot reload), then `q` to
   quit.
5. Optional: in the emulator settings, switch to dark mode and reopen the app.
   **Expect:** the app uses a dark theme.
6. Optional: check the app name on the emulator's home screen or app drawer.
   **Expect:** **BoothConnect**.

## Pass criteria

- Step 2 is clean, and step 3 shows the home screen on the emulator.

## Known issues and notes

- **`sqlcipher_flutter_libs` is retired.** Its latest version is marked
  `+eol` and does nothing: from `sqlite3` 3.x on, SQLCipher is chosen with a
  setting in `pubspec.yaml` (`hooks.user_defines.sqlite3.source: sqlcipher`).
  We use that instead, so the offline database can still be encrypted.
- **The first build needs internet access to GitHub.** The `sqlite3`
  package downloads the prebuilt SQLCipher library from its GitHub releases
  while building. On a restricted network the build fails in the
  `sqlite3` build hook.
- **Not yet checked on a real Android build.** The development container that
  created this issue can't reach the Android SDK downloads, so analyze and the
  widget test were run, but no APK was built. Step 3 is the first real build;
  please report any Gradle error in the PR.
- **iOS** builds need a Mac with Xcode. The iOS project is included but
  untested.
- **`pnpm lint` and `pnpm test` at the repo root now need Flutter installed**,
  because they include this app. To check only the JavaScript apps, use for
  example `pnpm --filter api lint`.
- **`lib/l10n/generated/` is created automatically** by `flutter pub get`
  (the lint and test scripts run it first) and isn't committed.
- **"Woah! You appear to be trying to run flutter as root"** only appears
  in Linux containers, never on Windows.
