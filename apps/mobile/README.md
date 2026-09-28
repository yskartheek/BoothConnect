# BoothConnect mobile (Flutter)

Field app for volunteers, for Android and iOS. Flutter stable channel.

```powershell
flutter doctor                      # check your Flutter + Android setup
pnpm --filter mobile start          # flutter run on the emulator or a device
pnpm --filter mobile lint           # dart format check + flutter analyze
pnpm --filter mobile test           # flutter test
pnpm --filter mobile format         # apply dart format
```

## Layout

| Path                    | What it holds                                               |
| ----------------------- | ----------------------------------------------------------- |
| `lib/main.dart`         | Entry point: wraps the app in a Riverpod `ProviderScope`    |
| `lib/app/`              | `MaterialApp.router`, theme and the go_router routes        |
| `lib/features/<name>/`  | One folder per feature (screens, providers, widgets)        |
| `lib/theme/`            | `AppTheme`, `GlassSurface`, generated `tokens.g.dart`       |
| `lib/l10n/*.arb`        | UI strings. `AppLocalizations` is generated from them       |
| `test/`                 | Widget and unit tests                                       |

All user-visible text goes in `lib/l10n/app_en.arb`, never directly in widgets.

## Main packages

Riverpod (state), go_router (navigation), Drift on SQLCipher (encrypted offline
database), flutter_secure_storage (keys and tokens), dio (HTTP),
connectivity_plus (online/offline), flutter_localizations + intl (strings).

SQLCipher is selected in `pubspec.yaml` under `hooks.user_defines.sqlite3`.
The `sqlite3` package downloads the matching prebuilt library from its GitHub
releases when the app is built.

## Theme and design tokens

Colours, sizes, text styles and motion come from
`packages/design-tokens/tokens.json`. `lib/theme/tokens.g.dart` is generated
from it, so never edit it by hand. After changing `tokens.json`, run:

```powershell
pnpm --filter @boothconnect/design-tokens build:dart
```

and commit the updated file. CI fails if you forget.

- `AppTheme.light()` / `AppTheme.dark()` build the `ThemeData`. Other tokens
  (glass, status colours, shadows) are available with `AppTokens.of(context)`.
- `GlassSurface` is the liquid-glass panel. It turns opaque, with no blur,
  when a `GlassSettings` above it has `reduceTransparency` or `lowEndDevice`
  set, or when high contrast is on (reported by iOS only).
