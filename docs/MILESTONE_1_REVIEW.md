# Milestone 1 review

**Date:** 2026-10-01 · **Reviewed at:** `main` @ `5c2f4d3` (after #206), plus
the open documentation PRs #207 (API guide), #208 (SETUP.md) and #209
(ADRs) · **Issue:** #81 (epic #8)

This review checks Milestone 1 against three sources:

- the gate tests in [plan §8](IMPLEMENTATION_PLAN.md#8-tests-milestone-1-gate);
- the spec's definition of done (§20);
- the implementation brief (§23), with the spec's test scenarios (§21) for
  context.

Each item links to the test or evidence that covers it. Items that aren't
covered are listed in [Gaps and follow-ups](#gaps-and-follow-ups), each with
its Milestone 2 issue. The spec is
[`VOTER_FIELD_OPERATIONS_APP_SPEC.md`](../VOTER_FIELD_OPERATIONS_APP_SPEC.md).

## Summary

- **Every plan §8 gate test exists and is green in CI** on `main`:
  [CI run #225](https://github.com/yskartheek/BoothConnect/actions/runs/36904420083),
  all five jobs passed (JS, API integration, mobile, admin web e2e, roll
  parser).
- **All 9 deliverables of the §23 brief are done.** Two deviate, by later
  product decisions recorded in ADRs: roll import from PDFs instead of CSV
  (ADR-0002), and caste/community enabled behind consent with direct edits
  instead of proposed/verified values (ADR-0003, ADR-0008).
- **Definition of done (§20):** 8 of 12 items are met, and 4 are partly
  met:
  - monitoring;
  - the security/privacy review;
  - user documentation;
  - a privacy fix for search terms in the API log.
- **Production is blocked** on the legal and policy decisions of spec §22
  (see [Open decisions](#open-decisions-spec-22--plan-11)), the spec §22
  legal review of caste/community, and the follow-ups marked **blocks
  production** below.

## Plan §8: Milestone 1 gate tests

CI job names: **API int** = "API integration (Postgres + Redis)", **JS** =
"JS (format, lint, typecheck, test, build)", **Mobile** = "Mobile (format,
analyze, test)", **Parser** = "Roll parser (lint, typecheck, test,
integration)". Test paths are relative to the app.

| Area          | Gate                                                                                                                                                     | Covered by                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | CI              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Authorization | Volunteer A requesting booth B's household/voter by ID gets 404; lists never return B's rows or counts                                                   | `api/test/cross-booth.int-spec.ts`: "reads by ID are 404", "lists contain nothing from booth B" (geographies, households, search, sync pull), "writes to booth B are refused", analytics. Its `ROUTES` table must list every endpoint.                                                                                                                                                                                                                                        | API int         |
| Suspension    | A suspended user's valid token gets 401 on the next request                                                                                              | `api/test/auth-suspension.int-spec.ts`: "plan §8: a suspended user's still-valid access token gets 401 on the next request"                                                                                                                                                                                                                                                                                                                                                   | API int         |
| Import        | Header outside the chosen node rejected; same checksum flagged duplicate; totals mismatch or low confidence forces review; nothing active before confirm | `api/test/import-extraction.int-spec.ts`: "a part-level batch rejects a roll for another part", "a totals mismatch forces review", "missing printed totals, the worker asking for review, or a row error force review". `import-uploads.int-spec.ts`: "re-uploading the same PDF is flagged as a duplicate and not queued". `import-confirm.int-spec.ts`: "a new part: nothing is live before confirm…", "a file with unresolved rows or a totals mismatch waits for review". | API int         |
| Extraction    | `roll-parser` reaches the agreed accuracy on fixture pages (text-layer and OCR); photos never stored                                                     | `roll-parser/tests/test_voters.py`: "test_committed_fixture_is_read_exactly", "test_accuracy_on_a_full_part" (571 boxes; gender, age, serial, EPIC ≥ 0.99, on clean and degraded scans); `test_header.py`. `test_worker.py`: "test_page_images_skip_the_maps_page" (the maps/photos page is never rendered or stored). See [G5](#gaps-and-follow-ups) for photos inside voter boxes, and #128 for the real sample.                                                            | Parser          |
| Analytics     | Parent metrics equal the sum of their children; groups < 10 (including via filters or subtraction) suppressed                                            | `api/test/node-stats.int-spec.ts`: "a parent equals its own counts plus the sum of its children, at every level". `analytics.int-spec.ts`: "a small area is suppressed, also where it could be worked out by subtraction".                                                                                                                                                                                                                                                    | API int         |
| CSV safety    | Values starting with `= + - @` are neutralized in the rejection export                                                                                   | `api/src/common/csv.spec.ts`: "neutralises values that a spreadsheet would run as a formula". `api/test/import-rejections.int-spec.ts`: "exports the rejected and warning rows, with formula-like values neutralised".                                                                                                                                                                                                                                                        | JS, API int     |
| Idempotency   | The same `/visits` or `/sync/push` twice gives one visit, and the same response                                                                          | `api/test/visits.int-spec.ts`: "the same request twice stores one visit and returns the same response", "the same clientId under a new key is recognised". `sync-push.int-spec.ts`: "replaying the same batch gives duplicates and stores nothing again", "the same queue sent twice at once is stored once". `idempotency.int-spec.ts` (replay, reuse, concurrency).                                                                                                         | API int         |
| Conflict      | Two stale edits to the same field produce a conflict, neither value is lost, and resolving keeps the chosen value with both in history                   | `api/test/field-value-writes.int-spec.ts`: "two stale edits to the same field: a conflict, and neither value is lost". `field-values.int-spec.ts`: "records a conflict, keeps both values current, and resolves it by the volunteer's choice". Mobile: `test/features/uploads_test.dart` (Choose value).                                                                                                                                                                      | API int, Mobile |
| Direct edits  | A volunteer edit is current immediately; official `source_data` unchanged; caste rejected without a consent record                                       | `api/test/field-value-writes.int-spec.ts`: "a first value is current immediately, and source_data is unchanged", "caste without a valid consent: CONSENT_REQUIRED". `member-edits-conflicts.int-spec.ts`: "an edit is current immediately and source_data is unchanged". `field-values.int-spec.ts`: "requires consent where configured…".                                                                                                                                    | API int         |
| Audit         | Import confirm, visit create and login each write a hash-chained event; UPDATE/DELETE on `audit_event` fails                                             | Login: `api/test/audit.int-spec.ts` (`auth.login`). Visit: `visits.int-spec.ts` (`visit.create` event). Import confirm: `import-confirm.int-spec.ts` (`import.file.confirm`). Chain and append-only: `audit-idempotency.int-spec.ts`: "links every event to the previous one and verifies the chain", "refuses UPDATE, DELETE and TRUNCATE on audit_event", "detects a tampered event".                                                                                       | API int         |
| Mobile        | Queue survives app restart; offline visit → reconnect → synced state                                                                                     | `mobile/test/e2e/offline_sync_test.dart` (#68): sign in, pull, visit offline, the app stopped and started again on the same encrypted database, reconnect, synced, against a real HTTP test server. `test/data/push_test.dart` (queue, backoff, replay).                                                                                                                                                                                                                      | Mobile          |

## Spec §20: Definition of done

| Item                                                             | Status | Evidence                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product acceptance criteria are met                              | Met    | Each closed Milestone 1 issue was closed by a merged PR, with its acceptance criteria ticked and a manual-testing guide in [`docs/manual-testing/`](manual-testing/README.md). Open: #78–#81 (in review) and #128.                                                                    |
| Backend authorization tested, including cross-booth attempts     | Met    | The cross-booth suite above; role checks (403) in each module's integration tests; ADR-0004.                                                                                                                                                                                          |
| Offline and sync behavior tested                                 | Met    | API: `sync-pull.int-spec.ts`, `sync-push.int-spec.ts`. Mobile: `push_test.dart`, `sync_repository_test.dart`, `offline_sync_test.dart`. ADR-0006.                                                                                                                                     |
| Loading, empty, error, denied, conflict and retry states         | Met    | Mobile: shared state widgets and sync chip (#58, `test/widgets/states_test.dart`) on every screen, Uploads with Choose value and Retry (#67). Admin web: shared states (#69, `components/states.test.tsx`).                                                                           |
| Accessibility checks pass                                        | Met    | Admin web: axe on every page in Playwright (#77, `e2e/accessibility.spec.ts`). Mobile: semantics labels, 2× text and small-screen tests in each screen's tests; reduced transparency (`test/theme/glass_system_settings_test.dart`). A manual screen-reader pass is still to do (G8). |
| Localization keys present, no hard-coded strings                 | Met    | `packages/i18n` (English and Telugu) generates the mobile ARB files and the web messages; `pnpm --filter @boothconnect/i18n test` checks both languages have every key. Mobile and admin web read every visible string from them.                                                     |
| Audit events for sensitive operations                            | Met    | Sign-in and out, views and edits of voters, visits, consents, imports, geography, users and roles, reading the audit log; ADR-0007.                                                                                                                                                   |
| Personal data doesn't leak into logs, analytics or notifications | Partly | Audit metadata is redacted (`audit/redact.ts`). Logs redact auth headers and cookies, and never log bodies. Analytics are thresholded. **But** the request log includes query strings, so a household search (`?q=` a name) is logged: **G1**. No notifications yet.                  |
| Automated unit, integration and e2e tests cover critical paths   | Met    | The gate table above; CI runs all of them on every PR.                                                                                                                                                                                                                                |
| API and user documentation updated                               | Partly | API: OpenAPI spec, Swagger UI and the guide [`docs/api/README.md`](api/README.md) (#78). Developers: [SETUP.md](SETUP.md) (#79), ADRs (#80), app READMEs. **No end-user guide** for volunteers and admins: **G9**.                                                                    |
| Monitoring and support diagnostics                               | Partly | `GET /v1/health` (database and Redis), a request ID on every response, in every log line and audit event, and structured JSON logs. **No metrics, error tracking or alerting**: **G6**.                                                                                               |
| Security/privacy review requirements satisfied                   | Partly | Built in: scope and 404 (ADR-0004), append-only data and audit (ADR-0005, ADR-0007), restricted fields gated in the database (ADR-0008), an encrypted phone database, rotating refresh tokens. **No independent security/privacy review or threat model yet**: **G7**.                |

## Spec §23: Implementation brief

| #   | Deliverable                                                                                                                               | Status         | Evidence                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Monorepo, local environment, linting, formatting, testing, CI                                                                             | Done           | pnpm + Turborepo workspace, `infra/docker-compose.yml`, `.github/workflows/ci.yml` (five jobs), [SETUP.md](SETUP.md). ADR-0001.                                                                                                                                         |
| 2   | Design tokens with accessible liquid-glass light/dark themes and reduced transparency                                                     | Done           | `packages/design-tokens` (CSS and Dart outputs, contrast checks in its tests); glass fallback when reduced transparency is on (mobile and admin web).                                                                                                                   |
| 3   | Backend modules and migrations for organizations, geography, users, role assignments, households, voters, imports, visits, consent, audit | Done           | `apps/api/src/*` and `apps/api/prisma/migrations/`.                                                                                                                                                                                                                     |
| 4   | Authentication interfaces and authorization enforcing role and geography scope                                                            | Done           | OTP sign-in, rotating refresh tokens, sessions (`auth/`); `GeoScopeGuard`, `@Roles()`, scoped queries (`authz/`). ADR-0004.                                                                                                                                             |
| 5   | Seed data                                                                                                                                 | Done           | `apps/api/src/database/seed/`: one organization, the S99 hierarchy with **two** booths (so cross-booth denial can be tested), an admin, two volunteers, households and voters. Synthetic only.                                                                          |
| 6   | Volunteer mobile slice: sign-in, households, voter details, visit form, local persistence, queued sync, sync state                        | Done           | Epic #6 (closed): sign-in, Home, Households, Household, Member details, Address and location, Visit, Uploads; Drift on SQLCipher; the push queue.                                                                                                                       |
| 7   | Admin web slice: sign-in, CSV import preview, booth progress, voter record review, audit view                                             | Done, deviated | Epic #7 (closed). **Roll import is from the official PDFs** (upload, extraction, review beside the page image, confirm), not CSV, by product decision (ADR-0002); geography master data is imported from CSV (#100). Booth progress is in the analytics explorer (#74). |
| 8   | Tests for cross-booth authorization, import validation, offline queue persistence, sync idempotency, audit-event creation                 | Done           | The plan §8 table above.                                                                                                                                                                                                                                                |
| 9   | Setup docs, ADRs, env template, API docs, commands for all apps                                                                           | Done           | [SETUP.md](SETUP.md) (#208), [ADRs 0001–0008](adr/README.md) (#209), `infra/env/.env.example`, [API guide](api/README.md) (#207) and OpenAPI.                                                                                                                           |

**The brief's constraints:**

- **"Keep restricted fields disabled":** religion and political affiliation
  are disabled. Caste/community is **enabled behind consent** by product
  decision (spec v1.1, ADR-0003). The database only allows it with consent
  and a legal basis (ADR-0008). The seed's legal basis is marked
  development-only.
- **No individual political profiling or sensitive-trait targeting:** none
  is implemented. There's no campaign targeting in Milestone 1, and
  analytics are aggregates only.
- **"Official values separate from proposed and verified values":** the
  official layer is kept separate (ADR-0005). Proposed/verified was
  replaced by direct edits (ADR-0003).
- **Idempotency keys, explicit conflicts, never discard changes:** done
  (ADR-0006).
- **Error, empty, denied, offline, retry and loading states:** done (§20
  above).

## Spec §21: Test scenarios

Not a Milestone 1 gate, but they show what's left.

| #   | Scenario                                                         | Milestone 1                                                                                                                                                                          |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Sign in, download, offline visits, restart, sync later           | ✅ `offline_sync_test.dart`                                                                                                                                                          |
| 2   | Another booth's voter through a modified request is denied       | ✅ cross-booth suite                                                                                                                                                                 |
| 3   | Two users edit the same field and get a conflict                 | ✅ (chosen by the volunteer, spec v1.1)                                                                                                                                              |
| 4   | Duplicate sync requests create one visit                         | ✅ visits and sync-push tests                                                                                                                                                        |
| 5   | Assignment revoked while offline; local access expires by policy | ⚠️ The server refuses at once, and the phone's next pull (a full snapshot of what's still assigned) clears the rest. **A phone that stays offline keeps its encrypted data**: **G3** |
| 6   | Voter self-registration discloses nothing                        | — Voter app is not in Milestone 1                                                                                                                                                    |
| 7   | Optional consent declined; the visit still completes             | ✅ caste unticked (`member_test.dart`), visits without consent                                                                                                                       |
| 8   | Consent withdrawn; future communications stop                    | ⚠️ Withdrawn values stop syncing and are deleted from phones, but **there's no way to record a withdrawal**: **G4**                                                                  |
| 9   | Import with malformed, duplicate and unknown-geography rows      | ✅ import extraction, review and confirm tests                                                                                                                                       |
| 10  | Analytics filter below the threshold is suppressed               | ✅ `analytics.int-spec.ts`                                                                                                                                                           |
| 11  | Sensitive-trait targeting is rejected                            | — Campaign management is not in Milestone 1                                                                                                                                          |
| 12  | CSV export formulas neutralized                                  | ✅                                                                                                                                                                                   |
| 13  | A lost device's session is revoked and can't sync                | ⚠️ Suspending the user, or the device signing out, stops it at once. **An admin can't revoke one device's session**, and the data stays on the phone: **G3**                         |
| 14  | Screen reader and large text through the visit flow              | ⚠️ Automated semantics and 2× text checks; **a manual TalkBack/VoiceOver pass is still to do**: **G8**                                                                               |
| 15  | Reduced transparency and motion                                  | ✅ glass fallback tests (mobile and admin web)                                                                                                                                       |

## Gaps and follow-ups

Each is an issue for Milestone 2. **Blocks production** means it must be
done before real voter data is used.

| ID  | Gap                                                                                                                                                        | Issue | Blocks production       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------- |
| G1  | The API's request log includes query strings, so a search term (a voter's name) is written to the log                                                      | #210  | **Yes**                 |
| G2  | Audit log: anchor the latest hash outside the database, and run the API as a database role that can't alter `audit_event` (ADR-0007)                       | #211  | **Yes**                 |
| G3  | Phone data after access ends: wipe or lock the local database when the session ends or the assignment is revoked; let an admin revoke one device's session | #212  | **Yes**                 |
| G4  | Consent withdrawal: an API and admin flow to record it, and an erasure procedure once retention is decided                                                 | #213  | **Yes**                 |
| G5  | Roll page images: mask the photo area of voter boxes, for states whose rolls print photos (the sample has a placeholder)                                   | #214  | **Yes**, for such rolls |
| G6  | Monitoring: metrics, error tracking and alerting for the API, the worker and the apps                                                                      | #215  | **Yes**                 |
| G7  | An independent security and privacy review (threat model, penetration test), and the production database and secrets setup                                 | #216  | **Yes**                 |
| G8  | A manual screen-reader (TalkBack, VoiceOver) and large-text pass of the volunteer flows, and iOS builds in CI (macOS)                                      | #217  | No                      |
| G9  | User guides for volunteers and admins (in English and Telugu)                                                                                              | #218  | No                      |
| G10 | The admin web's end-to-end tests run against a mock API; add a full-stack run against the real API and seed                                                | #219  | No                      |
| G11 | Roles per assignment, for users who hold different roles in different areas (ADR-0004)                                                                     | #220  | No                      |

Already open: **#128**, roll-parser confidence on the real S29 sample
(quality 0.43, target 0.8). It blocks importing real rolls at scale
without heavy manual review.

**Not gaps, but not in Milestone 1:** the spec's voter self-service app
(§7.6), campaign management (§7.7), tasks (§7.8) and notifications (§7.9).
They need their own epics when Milestone 2 is planned.

## Open decisions (spec §22 / plan §11)

| Decision                                                         | State                                                                                                                                                         | Blocks production?                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Deployment country and applicable election/privacy laws          | Open. Development assumes India (Telugu, Indian rolls, `+91`).                                                                                                | **Yes**: everything below depends on it |
| Voter-list source format and licensing/usage restrictions        | Format: decided for the sample state (PDF, ADR-0002). **Permitted use and licensing are open.**                                                               | **Yes**                                 |
| Approved fields (caste/community, affiliation, precise location) | Caste/community enabled behind consent (dev legal basis only); affiliation and religion off; household location with consent. **Needs the §22 legal review.** | **Yes**                                 |
| Hosting region and data residency                                | Open. Everything is self-hosted containers, so any region works.                                                                                              | **Yes**                                 |
| Retention periods                                                | Open. Data and audit are append-only, so retention needs an archive procedure (ADR-0005, ADR-0007).                                                           | **Yes**                                 |
| Identity-verification method                                     | SMS one-time codes; the SMS provider isn't chosen (development prints codes). Admin MFA is a placeholder.                                                     | **Yes**: an SMS provider and admin MFA  |
| Analytics cohort threshold                                       | Default 10, configurable per organization.                                                                                                                    | Confirm only                            |
| Review process for volunteer and voter updates                   | Decided: no review, direct edits with history (ADR-0003).                                                                                                     | No                                      |
| Required languages                                               | English and Telugu built; more are a translation task.                                                                                                        | No, for one state                       |
| Minimum iOS/Android versions                                     | Open. Flutter's defaults today; iOS isn't built in CI (G8).                                                                                                   | Before store release                    |
| One app or separate voter/volunteer apps                         | Open; only the volunteer app exists.                                                                                                                          | No (voter app is Milestone 2)           |
| Approved notification channels                                   | Open; no notifications yet.                                                                                                                                   | No                                      |
| Organization and tenancy model                                   | One organization per deployment; the schema has organizations and programs.                                                                                   | Before a second customer                |
| Deployment scale and peak concurrency                            | Open. No load testing yet.                                                                                                                                    | Before launch: load test with G6        |
| Household map provider                                           | The map preview is drawn on the phone (no tiles), so the location goes nowhere. Real map tiles need a provider and a privacy decision.                        | No                                      |
