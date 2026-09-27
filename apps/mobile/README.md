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
