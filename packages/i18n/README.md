# @boothconnect/i18n

Every user-visible string for both apps, in English (`en`, the source) and
Telugu (`te`, the regional language). Change strings here, never in the apps.

```text
locales/en.json   source: every key, plus "@key": { "description": … } for translators
locales/te.json   the same keys, translations only
```

Keys are flat and dotted. The first part says who uses them:

| Group            | Used by | Example key                                              |
| ---------------- | ------- | -------------------------------------------------------- |
| `visitOutcome.*` | both    | `visitOutcome.no_one_available` (the API's enum)         |
| `syncState.*`    | both    | `syncState.pending` ("On phone")                         |
| `error.*`        | both    | `error.UNAUTHENTICATED` (the API's `ErrorCode`)          |
| `consent.*`      | both    | `consent.caste.notice`                                   |
| `mobile.*`       | Flutter | `mobile.homeWelcome`                                     |
| `web.*`          | web     | `web.appearance.theme` (the app sees `appearance.theme`) |

## Commands

```sh
pnpm --filter @boothconnect/i18n check          # every key translated, same {placeholders}
pnpm --filter @boothconnect/i18n build          # dist/web/<locale>.json for the admin web
pnpm --filter @boothconnect/i18n build:mobile   # apps/mobile/lib/l10n/app_<locale>.arb + shared_labels.g.dart
```

`pnpm test` runs `check` and fails if the mobile files are out of date, so CI
catches a missing translation or a forgotten `build:mobile`.

## In the apps

- **Flutter:** the ARB files are committed (the Flutter CI job has no Node).
  `AppLocalizations` getters are camel-cased keys without `mobile.`:
  `l10n.homeWelcome`, `l10n.syncStatePending`, `l10n.errorUnauthenticated`.
  `shared_labels.g.dart` turns API codes into labels:
  `visitOutcomeLabel(l10n, 'refused')`, `syncStateLabel(…)`, `errorMessage(l10n, code)`.
- **Admin web:** `t('syncState.pending')` or `t('appearance.theme')` from
  `apps/admin-web/lib/i18n.ts`. Keys are type-checked.

## Adding a language

Add `locales/<code>.json` with every key, run `build:mobile`, and commit. The
check lists anything missing. Use a real language code (`hi`, `ta` …), so
Flutter's built-in widgets are translated too.

The Telugu strings are **drafts**. A native speaker must review them before
any real use, and the consent notice needs legal approval in both languages
(spec §22).
