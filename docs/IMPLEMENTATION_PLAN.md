# BoothConnect — Implementation Plan (Milestone 1)

Source spec: `VOTER_FIELD_OPERATIONS_APP_SPEC.md` (§23 Implementation Agent Brief)
Stack: **Flutter** (mobile) · **Next.js + TypeScript** (admin web) · **NestJS + TypeScript** (API) · **PostgreSQL 16** · **Redis** (jobs) · **OpenAPI** contract
Status: Draft for review — no code yet.

---

## 1. Monorepo layout

```text
boothconnect/
├── apps/
│   ├── api/                 NestJS REST API (/v1), OpenAPI generation
│   ├── admin-web/           Next.js admin portal (App Router)
│   ├── mobile/              Flutter app (volunteer first; voter later)
│   └── roll-parser/         Python worker: PDF electoral-roll extraction (ADR-0002)
├── packages/
│   ├── api-client/          TS client generated from OpenAPI (used by admin-web)
│   ├── design-tokens/       Single JSON source → CSS vars (web) + Dart ThemeData (mobile)
│   ├── i18n/                Shared locale files (en + regional), keys only in code
│   └── eslint-config/       Shared lint/format config
├── infra/
│   ├── docker-compose.yml   Postgres + Redis + MinIO (S3-compatible) for local dev
│   └── env/.env.example     Environment-variable template
├── docs/
│   ├── adr/                 Architecture decision records
│   ├── api/                 Generated openapi.json
│   └── SETUP.md             How to run everything
├── .github/workflows/ci.yml Lint, typecheck, test (api, web, mobile)
├── package.json             pnpm workspaces + Turborepo
└── VOTER_FIELD_OPERATIONS_APP_SPEC.md
```

Tooling: pnpm + Turborepo for JS/TS, Prettier + ESLint, `flutter analyze` + `dart format` for mobile, Jest for API, Vitest + Playwright for web, `flutter test` for mobile.

---

## 2. Backend modules (`apps/api/src/modules`)

| Module | Responsibility | Milestone 1 |
|---|---|---|
| `auth` | OTP sign-in (dev stub sends code to log), JWT access (15 min) + rotating refresh tokens, sessions table, revoke | ✅ |
| `users` | Users, status (active/suspended), MFA state | ✅ |
| `assignments` | RoleAssignment (role + geography node + validity window) | ✅ |
| `geography` | Org → Program → State → PC → AC → Part → Polling Station tree (closure table); State/PC/AC master data; see [design](design/voter-roll-pdf-import.md) | ✅ |
| `households` | Household records, scoped by booth | ✅ |
| `voters` | Voter source data + FieldValue current values with history (no approval step, spec v1.1) | ✅ |
| `field-definitions` | Configurable fields; restricted fields seeded **disabled** | ✅ |
| `visits` | Append-only visits + outcomes, idempotency keys | ✅ |
| `sync` | Batch push/pull for mobile, conflict detection | ✅ |
| `imports` | PDF electoral rolls uploaded at any hierarchy level → extraction by `roll-parser` → validate against printed totals → review/correct → confirm ([design](design/voter-roll-pdf-import.md)) | ✅ |
| `analytics` | Per-node metrics for every level with parent roll-ups and child comparison (`node_stats`), cohort ≥ 10 | ✅ |
| `consent` | Consent records (purpose, notice version, method, withdrawal) | ✅ |
| `audit` | Append-only, hash-chained audit events | ✅ |
| `submissions`, `tasks`, `campaigns`, `notifications`, `exports` | — | Later milestones |

Cross-cutting (`apps/api/src/common`):

- **`GeoScopeGuard`**: resolves the caller's active assignments to a set of permitted booth IDs and injects them into every repository query. Authorization never relies on the client, and a record outside scope returns **404** (not 403) so nothing leaks through enumeration.
- **`IdempotencyInterceptor`**: stores `Idempotency-Key` + request hash + response; a replay returns the stored response.
- **`AuditInterceptor`**: emits AuditEvent for sensitive actions; secrets and PII are redacted.
- **Errors**: structured `{ requestId, code, message, details }`; no stack traces.
- **Validation**: class-validator DTOs on every endpoint.

ORM: **Prisma** (typed, simple migrations). The exception is the audit table, which gets an append-only trigger through raw SQL.

---

## 3. Database entities (Milestone 1)

All IDs are UUIDv7 (opaque, sortable). Timestamps are `timestamptz` (UTC).

```text
organization          id, name, status, default_language, policy_config jsonb
election_program      id, organization_id, name, type, start_date, end_date, status
geography_node        id, program_id, parent_id, type (state|pc|ac|part|polling_station), code, name, metadata
geography_closure     ancestor_id, descendant_id, depth        -- fast scope checks
app_user              id, organization_id, name, phone, email, status, preferred_language, mfa_state
session               id, user_id, device_id, refresh_hash, expires_at, revoked_at
role_assignment       id, user_id, role, geography_node_id, valid_from, valid_until, granted_by
source_version        id, program_id, part_node_id, revision_type, label, published_on, checksum
import_batch          id, program_id, target_node_id, uploaded_by, status, file_count, confirmed_by, confirmed_at
import_file           id, batch_id, file_ref, checksum, page_count, detected_header jsonb, part_node_id,
                      source_version_id, extraction_method, quality_score, printed_totals jsonb,
                      extracted_totals jsonb, status, error jsonb
import_row_result     id, import_file_id, page, box_index, status(accepted|warning|rejected), messages jsonb,
                      field_confidence jsonb, corrected_values jsonb, corrected_by, corrected_at
household             id, polling_station_id, display_address, structured_address jsonb (house_no, street, area,
                      pin_code, landmark), location (lat/lng), location_accuracy_m, location_captured_at,
                      location_consent_id, origin (official_import|volunteer_added), source_version_id, status
voter                 id, household_id, part_id, polling_station_id, section_no, serial_no,
                      source_voter_id (EPIC), source_data jsonb (immutable),
                      record_status, origin (official_import|volunteer_added), import_file_id (null if added)
node_stats            node_id, metrics jsonb, computed_at            -- per-node analytics, rebuilt on confirm
field_definition      id, program_id, key, type, is_restricted, enabled, requires_consent, purpose
field_value           id, entity_type, entity_id, field_definition_id, value jsonb, source_type,
                      consent_id, collected_by, collected_at, supersedes_id, base_version,
                      conflict_with_id (set when two offline edits collide; cleared when the volunteer chooses)
visit                 id, household_id, volunteer_id, started_at, completed_at, outcome,
                      form_version, client_id (unique), notes
consent               id, subject_voter_id, purpose, notice_version, status, captured_method,
                      captured_by, captured_at, withdrawn_at
idempotency_record    key, user_id, request_hash, response jsonb, created_at
audit_event           id, actor_id, action, resource_type, resource_id, result, at,
                      session_id, metadata jsonb, prev_hash, hash
```

Key constraints:

- `voter.source_data` is never updated after import. Volunteer edits live in `field_value` as the **current value** straight away (no proposed/verified step, spec v1.1), with `supersedes_id` history.
- `visit.client_id` is unique, so a repeated sync can't duplicate a visit.
- `(program_id, source_voter_id)` is unique per source version.
- Volunteer-editable `field_definition` rows: name, age, gender, mobile, occupation, additional_info, and `caste_community` (enabled, `requires_consent = true`, restricted visibility).
- Restricted rows (religion, political affiliation) are seeded with `enabled = false`, and the API rejects writes to disabled fields.

---

## 4. API endpoints (Milestone 1, all under `/v1`)

```text
POST   /auth/otp/request            { phone }             → 202 (always, no enumeration)
POST   /auth/otp/verify             { phone, code }       → tokens
POST   /auth/refresh                                      → rotated tokens
POST   /auth/logout
GET    /me                                                → profile + active assignments
GET    /geographies?parentId&type&q                       (scoped; drives the level dropdowns)
POST   /geographies, /geographies/imports                 admin: State/PC/AC master data
GET    /households?boothId&q&status&cursor                (scoped, paginated)
GET    /households/:id                                    (scoped; 404 outside scope)
GET    /voters/:id                                        official values + current values + history
POST   /households                  Idempotency-Key       volunteer adds a household (address, optional location)
PATCH  /households/:id              Idempotency-Key       edit address / capture location (base_version checked)
POST   /households/:id/members      Idempotency-Key       volunteer adds a member not on the official list
PATCH  /voters/:id                  Idempotency-Key       edit member details → applied as current values
POST   /conflicts/:id/resolve       { keepFieldValueId }  volunteer chooses which value to keep
POST   /visits                     Idempotency-Key        append visit + field changes
GET    /sync/pull?since=cursor                            assigned-booth delta for offline
POST   /sync/push                  Idempotency-Key        batch of mutations → per-item result
                                                          (applied | duplicate | conflict | rejected)
POST   /imports/batches            { targetNodeId }       → batch (any hierarchy level)
POST   /imports/batches/:id/files                         → presigned upload URLs (PDF / ZIP)
POST   /imports/batches/:id/files/:fileId/complete        → extraction queued
GET    /imports/batches/:id                               per-file status, counts, quality
GET    /imports/files/:id/preview                         header, totals check, rows (paged)
GET    /imports/files/:id/pages/:n                        page image for correction
PATCH  /imports/files/:id/rows/:rowId                     correct or reject a row (audited)
POST   /imports/files/:id/confirm, /imports/batches/:id/confirm   → commit to active dataset
GET    /imports/files/:id/rejections.csv                  formula-injection-safe
GET    /analytics/nodes/:id/summary                       any level; aggregate only, cohort ≥ 10
GET    /analytics/nodes/:id/children?metric               child breakdown for parent analysis
GET    /analytics/nodes/:id/revisions                     changes between roll revisions
GET    /audit-events?actor&action&from&to                 admin only
```

**Conflict rule:** every field change carries the `base_version` (the `field_value` id the client last saw). If the server's current value for that field has moved on, the result is `conflict`, both values are kept, and the volunteer chooses which to keep on the phone (`POST /conflicts/:id/resolve`). There is no reviewer queue. Visits are append-only and always merge.

---

## 5. Mobile vertical slice (`apps/mobile`)

- **Architecture:** Riverpod + GoRouter + Drift (SQLite with SQLCipher encryption). The DB key lives in `flutter_secure_storage`.
- **Screens** (see `docs/design/volunteer-app-mockups.html`, iOS and Android): Sign-in (OTP stub) → Home (progress, offline banner) → Households list (search, filters, Add household) → Household (address + map, member cards, Add member) → Member details (all editable fields, caste behind consent) → Household address (structured fields, one-tap location) → Visit (outcome, who you met, edit from list, refusal path) → Uploads (queue + Choose value).
- **Status words shown to volunteers:** On phone, Uploading, Uploaded, Choose value, Not uploaded.
- **Sync queue:** a `pending_mutation` table (id, idempotency_key, payload, status, attempts, next_attempt_at, last_error). Retries back off exponentially (capped at 5 min) and are triggered by connectivity changes and app resume.
- **States visible everywhere:** loading, empty, error, denied, offline, pending, syncing, synced, conflict, failed.
- **Theme:** tokens from `packages/design-tokens` feed the liquid-glass light/dark theme. The glass effect falls back to opaque surfaces when reduced transparency is on or the device is low-end.
- **Strings:** all live in ARB files (en + one regional language placeholder).

## 6. Admin web vertical slice (`apps/admin-web`)

- Sign-in placeholder (OTP stub; MFA gate designed but stubbed)
- **Roll import:** pick the level with cascading dropdowns (State → PC → AC → Part), upload PDFs/ZIP, watch per-file extraction, review and correct rows beside the page image, then confirm
- **Analytics explorer:** any node from State to polling station — its metrics, sibling/parent comparison, sortable children table, drill-down with breadcrumbs (thresholded)
- **Booth progress:** assigned vs visited households and outcome breakdown (thresholded)
- **Voter record view:** official values vs current values, with who changed what and when
- **Audit explorer:** filterable table
- Uses TanStack Query plus the generated `api-client`, with accessible primitives from Radix/shadcn.

---

## 7. Seed data

One organization, one program, and a synthetic hierarchy: one state → one PC → one AC → two parts, each with one polling station (the **two booths**). The second booth exists so cross-booth denial can be tested. Users: 1 admin, 2 volunteers (one per booth). Data: about 40 households and 120 synthetic voters (fake names, no real data). Caste/community is enabled behind consent; religion and political affiliation are present but disabled.

---

## 8. Tests (Milestone 1 gate)

| Area | Test |
|---|---|
| Authorization | Volunteer A requesting booth B's household/voter by ID gets 404; list endpoints never return B's rows or counts |
| Suspension | Suspended user's valid token gets 401 on the next request |
| Import | A PDF whose header is outside the chosen node is rejected; re-uploading the same checksum is flagged duplicate; totals mismatch or low confidence forces review; nothing enters the active set before confirm |
| Extraction | `roll-parser` reaches the agreed field accuracy on the fixture roll pages (text-layer and OCR cases); photos are never stored |
| Analytics | Parent metrics equal the sum of their children; groups < 10 (including via filters or subtraction) are suppressed |
| CSV safety | Values starting with `= + - @` are neutralized in the rejection export |
| Idempotency | The same `/visits` or `/sync/push` twice gives one visit, and the same response is returned |
| Conflict | Two stale edits to the same field produce a conflict, neither value is lost, and resolving keeps the chosen value with both in history |
| Direct edits | A volunteer edit becomes the current value immediately; official `source_data` is unchanged; caste is rejected without a consent record |
| Audit | Import confirm, visit create and login each write a hash-chained event; UPDATE/DELETE on `audit_event` fails |
| Mobile | Queue survives app restart; offline visit → reconnect → synced state |

API integration tests run against a real Postgres (Testcontainers in CI, local Postgres in dev).

---

## 9. Build order

1. **Scaffold:** monorepo, lint/format, CI, docker-compose, `.env.example`, SETUP.md, ADR-001 (stack)
2. **Schema:** Prisma schema + migrations + audit trigger + seed
3. **API core:** auth stub, `GeoScopeGuard`, error format, audit, idempotency + tests
4. **API features:** households/voters/visits/sync + tests, then imports + tests, then OpenAPI export
5. **Design tokens** package → CSS + Dart outputs
6. **Mobile slice:** Drift DB, sync queue, screens + tests
7. **Admin web slice:** import wizard, progress, voter view, audit explorer + tests
8. **Docs pass:** API docs, run commands, and a milestone review

Each step ends with its smallest relevant tests passing before moving on.

---

## 10. Local machine prerequisites (Windows)

- **Node.js 24 LTS** + `corepack enable` (for pnpm)
- **Flutter SDK** (stable) + Android Studio (Android emulator). iOS builds need a Mac.
- **Docker Desktop** with the WSL 2 backend (runs Postgres/Redis/MinIO)
- **Git**

## 11. Open decisions (not blocking Milestone 1)

Deployment country and applicable law · electoral-roll PDF format per state, OCR languages and permitted use (see [design §10](design/voter-roll-pdf-import.md#10-open-questions-need-answers-before-implementation)) · identity-verification method · one app vs two · languages · minimum OS versions · hosting region · retention periods · analytics threshold (default 10) · tenancy model.
