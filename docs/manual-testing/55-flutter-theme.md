# #55: Design tokens as the Flutter theme (+ opaque glass fallback)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/55
**What changed:**

- `apps/mobile/lib/theme/tokens.g.dart` is **generated** from
  `packages/design-tokens/tokens.json`. It holds colours, glass, radius,
  spacing, text styles, shadows and motion as Dart constants
- `AppTheme.light()` and `AppTheme.dark()` turn those constants into the
  app's Material theme. The app now uses them instead of the placeholder blue
- `GlassSurface` is a new frosted-glass panel. It becomes solid, with no blur,
  when reduced transparency is on, when the device is marked as low-end, or
  when the phone is in high-contrast mode
- The home screen's welcome text now sits on a `GlassSurface`
- The design-tokens tests fail (in the CI "JS" job) if `tokens.g.dart` doesn't
  match `tokens.json`

## Steps

1. Check out the branch and install:
   ```powershell
   git checkout claude/issue-55-flutter-theme
   pnpm install --frozen-lockfile
   ```
2. Check the generated file is up to date:
   ```powershell
   pnpm --filter @boothconnect/design-tokens check:dart
   ```
   **Expect:** `tokens.g.dart is up to date.`
3. See the check catch a stale file. Open `packages/design-tokens/tokens.json`,
   change `"small": 12` (under `radius`) to `"small": 10`, and run step 2
   again.
   **Expect:** `… tokens.g.dart is out of date.` and an error. Then regenerate
   and look at the change:
   ```powershell
   pnpm --filter @boothconnect/design-tokens build:dart
   git diff apps/mobile/lib/theme/tokens.g.dart
   ```
   **Expect:** one line changed, `static const double small = 10;`. Undo both
   files afterwards:
   ```powershell
   git checkout -- packages/design-tokens/tokens.json apps/mobile/lib/theme/tokens.g.dart
   ```
4. Run the Flutter checks:
   ```powershell
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!` (11 tests). The
   test named `renders opaque with no blur when reduced transparency is on`
   is the one for this issue's acceptance criterion.
5. Run the app on the Android emulator:
   ```powershell
   pnpm --filter mobile start
   ```
   **Expect:** a light grey-blue background (`#F3F5FA`), and the welcome text
   on a rounded card with a thin border. The app bar uses the new colours.
6. Switch the emulator to dark mode (**Settings → Display → Dark theme**).
   **Expect:** dark navy background and a dark card, without restarting the
   app.

## Pass criteria

- Steps 2 and 4 pass, and step 3 shows the check catching the change.
- Steps 5 and 6 show the token colours in light and dark.

## Known issues and notes

- **The phone's own "Reduce transparency" setting isn't read yet.** Flutter
  doesn't report it (it only reports high contrast, bold text and animation
  settings), and there's no "low-end device" check either. `GlassSettings`
  takes both as inputs. Reading them from Android/iOS needs a small platform
  plugin, which is left for a later issue. Until then, the only system
  setting that turns glass solid is iOS **Increase Contrast** (Flutter reports
  high contrast on iOS only), so on the Android emulator you can't switch it
  from Settings. The widget tests cover all three cases.
- **Fonts aren't bundled yet.** The theme names Figtree and Bricolage
  Grotesque; until the font files are added, phones use their system font.
- **On a plain background glass looks almost solid.** The effect shows once
  screens have coloured backdrops or content scrolling behind glass bars.
- **Only `lib/theme/tokens.g.dart` is generated.** `app_theme.dart` and
  `glass_surface.dart` are hand-written and can be edited normally.
