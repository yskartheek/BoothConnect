# @boothconnect/api

NestJS 12 REST API. Every route is under `/v1`.

```powershell
pnpm infra:up                  # Postgres, Redis, MinIO (from the repo root)
pnpm --filter api dev          # http://localhost:4000/v1/health, restarts on changes
pnpm --filter api test         # unit + HTTP tests (no Docker needed)
pnpm --filter api test:int     # integration tests against real Postgres + Redis
pnpm --filter api build        # compile to dist/
pnpm --filter api start        # run the compiled build
```

## Layout

| Path                 | What it holds                                                    |
| -------------------- | ---------------------------------------------------------------- |
| `src/main.ts`        | Bootstrap: logger, `configureApp`, listen on `API_PORT`          |
| `src/app.setup.ts`   | Global prefix, CORS, shutdown hooks (shared with the HTTP tests) |
| `src/config/`        | Environment validation (zod) and logging setup                   |
| `src/auth/`          | Sign-in with a one-time code (OTP) and session tokens            |
| `src/redis/`         | The shared Redis client (`@Inject(REDIS)`)                       |
| `src/common/`        | Error format, validation pipe and other cross-cutting pieces     |
| `src/health/`        | `GET /v1/health`: checks the database and Redis, 200 or 503      |
| `test/*.e2e-spec.ts` | HTTP tests against the real app wiring, external services faked  |

## Configuration

Settings come from environment variables, then `apps/api/.env`, then the
repository-root `.env` (template: `infra/env/.env.example`). The API refuses
to start if a required variable is missing or invalid, and lists every
problem.

## Logging

Logs are JSON lines (pino), pretty-printed when `NODE_ENV=development`. Each
request gets an ID: a well-formed `X-Request-Id` header from the caller is
kept, otherwise a UUID is generated. The ID is returned in the
`X-Request-Id` response header and attached to every log line of that
request. `Authorization` and `Cookie` headers are redacted.

## Errors and validation

Every error response has the same shape, whatever went wrong:

```json
{
  "requestId": "3f1c…",
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "details": [{ "field": "address.pinCode", "errors": ["pinCode must be …"] }]
}
```

- `requestId` matches the `X-Request-Id` header and the log lines.
- Clients branch on `code` (`src/common/errors/error-codes.ts`), never on
  `message`. Codes are never renamed.
- 5xx responses never contain stack traces or error messages. The details go
  to the log (with the request ID), not to the client.
- Request bodies are validated with class-validator DTOs. Unknown properties
  are a 400, not silently dropped, and submitted values are never echoed back.
- Throw `AppException(status, code, message, details?)` for errors a client
  should act on. Prisma's unique-violation (`P2002` → 409
  `UNIQUE_VIOLATION`), foreign-key (`P2003` → 409) and not-found
  (`P2025` → 404) errors are mapped automatically.

## Sign-in (one-time codes)

1. `POST /v1/auth/otp/request { "phone": "+919999900001" }` always answers
   **202**, whether or not the phone is registered, so the endpoint can't be
   used to find out who has an account. Only an **active** user gets a code.
   Requests are limited per phone number (`OTP_REQUEST_LIMIT` per
   `OTP_REQUEST_WINDOW_SECONDS`, then 429 `RATE_LIMITED`), registered or not.
2. The 6-digit code is stored in Redis only as an HMAC (keyed with
   `JWT_REFRESH_SECRET`), with a TTL (`OTP_TTL_SECONDS`) and an attempt count.
   With `OTP_DEV_MODE=true` the code is written to the API log instead of
   being sent; the API refuses to start in production with that setting. No
   SMS provider is integrated yet.
3. `POST /v1/auth/otp/verify { phone, code, deviceId }` returns
   `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn }` and
   creates a `session` for the device. A code works once; a wrong code is 401
   `OTP_INVALID`, and after `OTP_MAX_ATTEMPTS` wrong codes it is deleted
   (401 `OTP_LOCKED`).

The access token is a 15-minute HS256 JWT with `sub` (user ID) and `sid`
(session ID). The refresh token is an opaque random value; only its HMAC is
stored on the session.

## Sessions and access tokens

- **Every route needs `Authorization: Bearer <access token>`** (the global
  `JwtAuthGuard`), unless it is marked `@Public()` (health, the OTP endpoints,
  refresh). The token must be valid, its session still open and its user
  active; otherwise 401 `UNAUTHENTICATED`. Session and user status are read
  from the database on every request (one indexed query, not cached), so a
  logout or a suspension takes effect on the next request. `@CurrentUser()` gives `{ userId, sessionId }`.
- `POST /v1/auth/refresh { refreshToken }` returns a new pair and retires the
  old refresh token. Hashes of retired tokens are kept in Redis until they
  would have expired; **presenting a retired token revokes the whole
  session** (the token was copied, or the copy was used first). A suspended
  user can't refresh; their sessions stay open, so reactivating them restores
  their devices without a new sign-in.
- `POST /v1/auth/logout` (signed in) revokes the session: its access and
  refresh tokens stop working. Other devices stay signed in.
- Tests: `loginAs(t, phoneOrUserId)` (`test/support/auth.ts`) returns a
  signed-in supertest agent.
- `GET /v1/me` returns the caller's profile and their **active** role
  assignments (started, and not yet ended; `valid_until` is exclusive), each
  with its node and the `path` from the state down to that node.

## Geographic scope and roles

Every signed-in request gets `req.scope` (`@CurrentScope()`): the caller's
roles and **every polling station under any of their active assignments**,
found through `geography_closure`. An assignment on a booth covers that booth;
on a part, its main and auxiliary booths; on an AC or higher, every booth
below it.

- **Booth-level data is only ever queried through the scope:**
  `where: { ...inScope(scope), … }` (`src/authz/scoped-query.ts`). An empty
  scope matches nothing.
- **A record outside the scope is 404, never 403**, exactly like a record
  that doesn't exist (`foundInScope(record, 'Household')`), so IDs can't be
  probed.
- `@Roles('admin', 'campaign_manager')` limits a route to callers holding one
  of those roles in an active assignment; others get 403 `FORBIDDEN`.
- The guards run in order: access token (401) → scope and roles (403);
  `@Public()` routes skip both.

## Geography and pagination

- `GET /v1/geographies?parentId=&type=&q=&limit=&cursor=` lists the direct
  children of a node (or the top level), and `GET /v1/geographies/:id`
  returns a node with its `path` from the top. A node is visible when it's
  one of the caller's assigned nodes, **below** one, or **above** one (the
  path to it). Another booth or part at the same level is not visible, and
  asking for it by ID is 404.
- Children are ordered **naturally** by code (`length(code), code, id`: 1, 2,
  10, 408; "1A" after "9"). `q` matches the start of the code or part of the
  name; `%` and `_` are literal.
- Lists are paginated with an opaque **keyset cursor**:
  `{ items, nextCursor }`, `limit` default 50, max 200 (`src/common/pagination.ts`).
  Pages stay stable when rows are added elsewhere in the list.

## Households

`GET /v1/households?boothId=&q=&status=&limit=&cursor=` lists **active**
households at the caller's booths (all of them, or one `boothId`), ordered by
ID with a keyset cursor. A `boothId` outside the scope gives an empty page,
exactly like an empty booth: no totals, nothing to tell them apart.

- `q`: part of the address, the start of the house number, a member's name
  (from the roll, or the current value a volunteer entered) or the start of
  an EPIC number.
- `status` is the **visit status** (spec §7.3), from the latest visit that
  no later visit corrects: `not_visited`, `visited` or `follow_up` (latest
  outcome `follow_up_requested`).
- Each item has `voterCount` (active members) and `lastVisit`
  (`{ outcome, startedAt }` or null).

`GET /v1/households/:id` returns one household: address (display and
structured), location (captured with consent, or null), status, its active
**members** and its **last visit**. A household outside the caller's scope
gets the same 404 as a missing ID.

- Members come in roll order (section, serial), volunteer-added members last.
  `name`, `age` and `gender` show the current value a volunteer entered, else
  the roll's; `relationType` and `relativeName` are the roll's. Nothing else,
  and no restricted field, is in the summary (full details: `GET /v1/voters/:id`).
  `hasConflict` is true while two offline edits of one of the member's fields
  wait for the volunteer to choose.
- `lastVisit` is the latest visit that no later visit corrects:
  `{ id, outcome, startedAt, completedAt, volunteerId, memberIdsMet }`, or null.

### Adding households and members, editing the address

All three need `Idempotency-Key`, are for volunteers and admins, are audited
(`household.create`, `household.update`, `member.create`) and run in one
transaction.

- `POST /v1/households` `{ id?, pollingStationId, address, location? }`: a
  household not on the roll (`origin: volunteer_added`) in one of the
  caller's booths (else 404). `address` has `house_no`, `street`, `area`,
  `pin_code` (6 digits) and `landmark`; a house number or street is needed.
  `location` is `{ lat, lng, accuracyM?, capturedAt, consent: { noticeVersion,
method } }`: a consent record is created with it. A house number already in
  the part gets 409 `UNIQUE_VIOLATION` (the house is probably there already).
  `id` is optional and made on the phone; sending an `id` that exists
  returns that household with `duplicate: true`.
- `PATCH /v1/households/:id` `{ address?, addressBaseVersion?, location?,
locationBaseVersion? }`: each field sent needs its base version (the value
  ID the phone last saw, or null). The answer has the household and a
  result per field (`applied | conflict | rejected`).
- `POST /v1/households/:id/members` `{ id?, name, age?, gender?, fields? }`:
  a member not on the roll (no EPIC number, no `source_data`). Each value is
  written as a field value and reported; the member is added if the name is
  saved (else 422).

Address and location are household **field values** (fields `address` and
`household_location`, types `address` and `location`), so they get the same
conflict checks and history as member details. When one becomes current,
the household row is updated to match: `structured_address`, the
`display_address` shown in lists ("12/4, Gandhi Road, Nehru Nagar, 500038";
the landmark is left out), the `location_*` columns and, for households a
volunteer added, the house number used as `house_key`. A conflicting value
doesn't change the row until the volunteer chooses.

## Voters

`GET /v1/voters/:id[?history=true]` returns one member: `official` (the
roll's `source_data`, never changed by edits; null for volunteer-added
members) and `fields`, every **enabled** field the caller may see, set or not.

- Each field has `current`: usually one value, two while an offline conflict
  waits, empty if never set. A value carries `id` (send it as `base_version`
  when editing), `value`, `sourceType`, `collectedBy {id, name}`,
  `collectedAt`, `supersedesId` and `conflictWithId`.
- `?history=true` adds `history` to each field: every earlier value, newest
  first; follow `supersedesId` for the chain.
- Disabled fields (religion, political affiliation) are never returned, even
  if a value exists.
- Restricted fields (caste/community) are returned only to `admin` and
  `volunteer` (`RESTRICTED_FIELD_ROLES`); campaign managers don't get the
  field at all. A consent-gated value is shown only while its consent is
  granted; once withdrawn it disappears, history included.
- A voter outside the caller's scope gets the same 404 as a missing ID.

### Editing members and choosing between conflicting values

- `PATCH /v1/voters/:id` (volunteers and admins, `Idempotency-Key`,
  audited as `voter.update` with field keys and outcomes, never values)
  `{ fields: [{ fieldKey, value, baseVersion, consentId? }] }`: each field
  goes through the field-value service and comes back `applied`, `conflict`
  or `rejected`. A voter outside the scope gets 404.
- `POST /v1/conflicts/:id/resolve { keepFieldValueId }` (volunteers and
  admins, audited as `conflict.resolve`): `:id` is either value of a
  conflict (sync pull lists both). The kept value stays current, the other
  leaves the current set but stays in history, and the conflict marks are
  cleared; for an address or location, the household row follows the kept
  value. Keeping the same value again is a no-op (`already_resolved`). A
  value outside the caller's booths is 404; a `keepFieldValueId` that isn't
  one of the conflicting values is 409.

Restricted fields (caste/community) can only be written, resolved or seen by
`RESTRICTED_FIELD_ROLES` (admin, volunteer); to anyone else the field is
unknown (`FIELD_UNKNOWN`, or 404 for a conflict).

## Writing field values

Every edit of a member or household field (visits, sync push, member and
household edits) goes through `FieldValuesService.write(scope, userId,
changes, tx?)`. It returns one result per change, and a rejected change
doesn't stop the others:

| Result     | When                                                                                                                                                                                  | Stored                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `applied`  | `baseVersion` is the current value (or null and the field was never set)                                                                                                              | a new current value that supersedes the old one                                     |
| `conflict` | the field moved on since `baseVersion`, or a conflict is already open                                                                                                                 | the new value, with `conflictWithId`; both stay current until the volunteer chooses |
| `rejected` | `NOT_FOUND` (entity outside the scope), `FIELD_UNKNOWN`, `FIELD_DISABLED`, `INVALID_VALUE`, `CONSENT_REQUIRED` (no granted consent for this person and field), `BASE_VERSION_INVALID` | nothing                                                                             |

Values are never updated in place and `source_data` is never touched. Writers
of one entity's field are serialised with a transaction-scoped advisory lock,
so two edits can't both supersede the same value. Pass `tx` to write inside
the caller's transaction (e.g. with a visit).

Value rules: `text` up to 2000 characters (not blank), `number` finite,
`boolean`, `date` as a real `YYYY-MM-DD`, `phone` in E.164, `single_select` /
`multi_select` from the field's options. Clearing a field isn't supported yet.

## Visits

`POST /v1/visits` (volunteers and admins, `Idempotency-Key` required) records
one visit to a household in the caller's scope (else 404):

```json
{
  "clientId": "uuid made on the phone",
  "householdId": "…",
  "startedAt": "2026-09-20T10:00:00Z",
  "completedAt": "2026-09-20T10:15:00Z",
  "outcome": "completed",
  "formVersion": "2026.1",
  "notes": "optional, no sensitive details",
  "memberIdsMet": ["voter id", "…"],
  "consents": [
    {
      "ref": "c1",
      "voterId": "…",
      "purpose": "caste_community",
      "noticeVersion": "2026.1",
      "method": "in_person_verbal"
    }
  ],
  "fieldChanges": [
    {
      "entityType": "voter",
      "entityId": "…",
      "fieldKey": "caste_community",
      "value": "…",
      "baseVersion": null,
      "consentRef": "c1"
    }
  ]
}
```

- The visit, the members met, the consents, the field changes (through the
  field-value service) and the `visit.create` audit event are stored in **one
  transaction**: all or nothing.
- The answer (201) has the visit, `consents` (`{ref, id}` for each one
  created) and `fieldChanges`, one `applied | conflict | rejected` result per
  change in request order. A rejected or conflicting change doesn't stop the
  visit. Field changes may only touch this household and its members
  (otherwise `rejected`, `NOT_FOUND`).
- A consent without `voterId` is for the household (e.g. `household_location`).
  A change refers to a consent from the same visit by `consentRef`, or to an
  earlier one by `consentId`.
- The same `clientId` is never stored twice. A retry with the same key gets
  the stored response (`Idempotency-Replayed: true`); a retry under a new key
  gets the stored visit with `duplicate: true`, and nothing is applied again.
  A `clientId` used by another volunteer or household is 409.
- **Corrections** ("edit from list"): send `correctsVisitId` with the earlier
  visit's ID. Both are kept (visits are immutable); the corrected visit no
  longer counts for the household's last visit or visit status. Only the
  volunteer who recorded it, or an admin, may correct a visit (else 403), and
  only once (409: correct the latest version instead); it must be a visit to
  the same household (else 422).
- 422 `UNPROCESSABLE` for times in the future (more than 10 minutes ahead),
  `completedAt` before `startedAt`, members met or consent subjects outside
  the household, duplicate consent refs, or an unknown `consentRef`.

## Offline sync: pull

`GET /v1/sync/pull?since=<cursor>&limit=` sends the phone what changed on the
caller's booths. Without `since` (first run) it is a **full snapshot**
(`reset: true`: replace everything stored). Keep calling with the returned
`cursor` while `hasMore` is true; the last page's `cursor` is the `since` for
the next pull.

- Each page has up to `limit` rows (default 500, max 2000) across
  `fieldDefinitions`, `households`, `voters`, `fieldValues` and `visits`, sent
  in that order. The phone upserts rows by `id`.
- A snapshot has active households and voters, enabled field definitions and
  current values only. A delta also has rows that went away: a household
  `status` of `removed`, a voter `recordStatus` other than `active`, a field
  definition with `enabled: false`, a value with `isCurrent: false`.
- The last page also has `conflicts` (every open conflict: both values, who
  entered each and when, for **Choose value**) and `removedFieldValueIds`
  (values hidden because the person withdrew consent).
- Restricted fields follow `GET /v1/voters/:id`: only admins and volunteers
  get them, and a consent-gated value only while the consent is granted.
- If the caller's booths or restricted-field access changed since the cursor,
  the pull starts again as a full snapshot (`reset: true`).

**The cursor** holds a database snapshot, not a time: the first transaction
ID not yet handed out and the IDs still running. Every synced row carries the
ID of the transaction that last wrote it (`change_xid`, set by a trigger), and
the next pull asks for exactly the rows that snapshot couldn't see. A slow
transaction that commits after a pull is therefore never skipped, which
timestamps can't guarantee, and nothing is sent twice.

## Audit log

`audit_event` is append-only and hash-chained **by the database**: on insert it
assigns `seq`, links the event to the previous one and computes
`hash = sha256(prev_hash | event)` under an advisory lock, and it refuses
UPDATE, DELETE and TRUNCATE. The API only inserts:

- `AuditService.record({ action, resourceType, resourceId, result, actorId,
sessionId, requestId, metadata })`. `metadata` is **redacted** first
  (`src/audit/redact.ts`): credentials, codes, tokens and personal data (names,
  phones, addresses, EPIC numbers, ages, locations…) by key, and phone- and
  token-shaped strings anywhere. The log says who did what to which record,
  never the data itself.
- `@Audited({ action, resourceType })` on a route records `success`, or
  `failure` with the error code, for every call.
- Recorded so far: `auth.login` (success, and failure with the reason; never
  the phone or code) and `auth.logout`.
- `AuditService.verifyChain()` (SQL `audit_verify_chain()`) returns null
  when the chain is intact, otherwise the `seq` of the first broken event.
- `seq` values have gaps (the column default and the trigger both draw from
  the sequence). That's expected: integrity comes from the hash chain, which
  `verifyChain()` checks, not from consecutive numbers.

## Idempotent writes

Writes that a phone may retry (sync, visits, uploads) are marked
`@Idempotent()`. The client sends `Idempotency-Key: <uuid>`, one per logical
operation and the same for every retry of it.

- **A retry of a completed request** (same user, key, method, path and body;
  the body compared with key order ignored) gets the **stored response** back,
  with the original status and `Idempotency-Replayed: true`. The write doesn't
  run again.
- **The same key with a different request** → 422 `IDEMPOTENCY_KEY_REUSED`.
- **A duplicate while the first is still running** waits (up to 5 s) for
  its result and replays it. If the first fails or is still running → 409
  `IDEMPOTENCY_IN_PROGRESS`; retry later. A Redis lock per user and key makes
  sure only one runs.
- **Failed requests aren't stored**, so a retry can succeed.
- Missing or malformed key (8–128 of `A–Z a–z 0–9 - _`) → 400
  `IDEMPOTENCY_KEY_REQUIRED`.
- Responses are kept `IDEMPOTENCY_TTL_SECONDS` (default 7 days) in
  `idempotency_record`; a cleanup job for expired rows comes later.

## Database (Prisma 7)

```powershell
pnpm infra:up                      # Postgres must be running
pnpm --filter api db:deploy        # apply all migrations
pnpm --filter api db:migrate       # after editing schema.prisma: create + apply a migration, regenerate the client
pnpm --filter api db:seed          # load the synthetic demo data (safe to run again; src/database/seed)
pnpm --filter api db:reset         # drop everything, re-apply migrations, seed (asks to confirm)
pnpm --filter api db:studio        # browse the data in the browser
pnpm --filter api db:generate      # regenerate the client (also runs on pnpm install)
```

Conventions for every model:

- **IDs are UUIDv7**, generated by Prisma in the application:
  `id String @id @default(uuid(7)) @db.Uuid`. PostgreSQL 16 has no built-in
  UUIDv7 function (it arrives in PostgreSQL 18), and generating IDs in the app
  keeps them sortable by creation time without a custom SQL function. Rows
  inserted with raw SQL must supply their own ID.
- **Timestamps are `DateTime @db.Timestamptz`** and always UTC. The baseline
  migration also sets the database's session time zone to UTC.
- **Names:** models and fields in PascalCase / camelCase, mapped to snake_case
  tables and columns with `@@map` / `@map`.
- The generated client lives in `src/generated/prisma` (git-ignored) and is
  CommonJS, like the rest of the API.
- `prisma.config.ts` loads `apps/api/.env`, then the repository-root `.env`,
  because Prisma 7 no longer reads `.env` files by itself.
- Rules Prisma can't express (check constraints, triggers) are appended by
  hand to the generated `migration.sql`, under a "Hand-written" comment.
  Prisma ignores them when comparing the schema with the database, so they
  don't show up as drift. Create the migration with
  `pnpm --filter api exec prisma migrate dev --create-only --name <name>`,
  add the SQL, then run `pnpm --filter api db:migrate`.
- Integration tests never touch the database in `DATABASE_URL`. Each run
  builds a migrated and seeded template (`<db>_it_template`) and gives every
  test file its own copy (`<db>_it_<random>`), dropped when the file ends
  (`test/support/test-databases.cjs`). So every file starts from the same
  seed data, and files run in parallel.
  - Database-only tests: `connectDatabase()` plus `inRollback()`
    (`test/support/database.ts`) and the builders in `test/support/fixtures.ts`.
  - HTTP tests: `createTestApp()` (`test/support/app.ts`) starts the full API
    against the file's database; `t.http().get('/v1/…')`.
- Partial indexes with a `raw()` condition must use the text PostgreSQL
  stores (check with `pg_get_expr`), or Prisma reports drift every time.
  `pnpm --filter api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
  must exit with 0.
