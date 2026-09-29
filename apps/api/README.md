# @boothconnect/api

NestJS 12 REST API. Every route is under `/v1`.

```powershell
pnpm infra:up                  # Postgres, Redis, MinIO (from the repo root)
pnpm --filter api dev          # http://localhost:4000/v1/health, restarts on changes
pnpm --filter api test         # unit + HTTP tests (no Docker needed)
pnpm --filter api test:int     # integration tests against real Postgres, Redis and MinIO
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

### Master data: States, PCs and ACs (#100)

The State → PC → AC list is loaded from a CSV before any roll is imported
(template: `docs/templates/geography-master.csv`, synthetic rows only).
Parts and polling stations come from roll imports, not from here.

- `POST /v1/geographies/imports` `{ csv, confirm?, programId? }` (admin,
  `Idempotency-Key`). Columns: `level` (state, pc, ac), `code`, `name`,
  `parent_code` (a PC's State code, an AC's PC code), and optional
  `reservation` (GEN, SC, ST…) and `state_code` (needed when two States
  have a PC with the same code).
  - Without `confirm` it only reports what would happen, row by row:
    `create`, `update` (name or reservation changed), `unchanged` or
    `error` with the reasons (unknown parent, duplicate row, missing
    code…). Rows can be in any order; parents are handled first.
  - With `confirm: true` it saves every row in one transaction, or nothing
    (422 with the report in `details`) when any row has an error.
    Re-uploading the same file changes nothing; nodes are never deleted.
  - A problem with the file itself (missing or unknown columns, no rows,
    more than 5,000 rows, a quote never closed) is 422.
- `POST /v1/geographies` `{ type, code, name, reservation?, parentId? }`
  adds one node, and `PATCH /v1/geographies/:id` `{ name?, reservation? }`
  renames it or changes its reservation (`null` removes it). Code, type and
  parent never change. Both need `Idempotency-Key`.
- Who can change what: an admin changes their own area (an AC admin only
  their AC). An admin of a State manages the program's whole list,
  including adding States. Anything else is "Outside your area" in the
  report, or 404.
- Audited as `geography.import` (counts), `geography.create` and
  `geography.update` (field names only).

### Auxiliary polling stations (#101)

A part has one main polling station and may have auxiliary ones (408A…),
proposed from the roll's cover page during review and created on confirm.
An auxiliary station takes the voters whose **section** or **serial
number** it covers; everyone else is at the main station.

- `GET /v1/geographies/:id/stations` (admin; `id` is a part or one of its
  stations): the part's stations with their coverage and active voters.
- `PUT /v1/geographies/:id/coverage` `{ coverage: { sections?, serials?: { from, to } } | null }`
  (admin, `Idempotency-Key`) sets an auxiliary station's coverage; `null`
  clears it. In one transaction it:
  - moves the part's voters from the roll to the station that now covers
    them (or back to the main station), their households to their members'
    most common station, and volunteer-added members with their household;
  - rejects (422) a main station, a shared section or overlapping serial
    ranges with another auxiliary station, and a coverage that would put any
    voter in two stations (e.g. one station's section holding another's
    serial numbers);
  - refreshes the part's analytics, and marks the part's stations so phones
    on them take a full snapshot at their next sync;
  - is audited as `geography.coverage` (the coverage and counts moved).
- Volunteers are assigned to stations, so their booths follow the move.
- Import confirm uses the same rules for a new revision of the part.

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
  or voters were moved between the stations of one of their booths' parts
  (auxiliary coverage, #101), the pull starts again as a full snapshot
  (`reset: true`).

**The cursor** holds a database snapshot, not a time: the first transaction
ID not yet handed out and the IDs still running. Every synced row carries the
ID of the transaction that last wrote it (`change_xid`, set by a trigger), and
the next pull asks for exactly the rows that snapshot couldn't see. A slow
transaction that commits after a pull is therefore never skipped, which
timestamps can't guarantee, and nothing is sent twice.

## Offline sync: push

`POST /v1/sync/push` (volunteers and admins, `Idempotency-Key` for the whole
batch) takes the phone's queue, up to 200 changes, and applies them **in
order, each in its own transaction**, returning one result per change. A bad
change never stops the others.

```json
{ "mutations": [{ "key": "m-…", "type": "household.create", "payload": { … } }] }
```

| `type`             | `payload`                                                                          |
| ------------------ | ---------------------------------------------------------------------------------- |
| `visit.create`     | as `POST /v1/visits`                                                               |
| `field.change`     | `{ entityType, entityId, fieldKey, value, baseVersion, consentId?, collectedAt? }` |
| `consent.capture`  | `{ id?, voterId \| householdId, purpose, noticeVersion, method, capturedAt? }`     |
| `household.create` | as `POST /v1/households`                                                           |
| `household.update` | `{ id, …as PATCH /v1/households/:id }`                                             |
| `member.create`    | `{ householdId, …as POST /v1/households/:id/members }`                             |
| `conflict.resolve` | `{ conflictId, keepFieldValueId }`                                                 |

Each result is `{ key, type, status, result?, current?, code?, message?, details? }`:

- `applied`: stored; `result` is what the matching endpoint returns.
- `duplicate`: already stored. Either the item `key` was pushed before (the
  stored `result` is returned) or a record with the phone's `id`/`clientId`
  exists, or a conflict was already resolved. Nothing is stored again.
- `conflict`: stored, but the field had moved on; `current` has the server's
  current values (both clashing values) for **Choose value**.
- `rejected`: nothing stored; `code` and `message` say why (`VALIDATION_FAILED`
  with `details`, `NOT_FOUND` for anything outside the caller's booths,
  `FIELD_DISABLED`, `CONSENT_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` for a key
  already used for a different change, …).

Later items can refer to what earlier ones created through the ids the phone
made (`household.create` `id`, `member.create` `id`, `consent.capture` `id`).
Each item key is kept like an `Idempotency-Key` (`IDEMPOTENCY_TTL_SECONDS`) and
locked while the item runs, so the same queue sent twice, even at the same
time, stores everything once.

## Roll imports: batches and uploads

Admins only (anyone else gets 403), always inside their own area (404
otherwise). Design: `docs/design/voter-roll-pdf-import.md` §3 and §6.

1. `POST /v1/imports/batches { targetNodeId }` (`Idempotency-Key`) opens a
   batch at a State, PC, AC or Part at or below the admin's assignment (a
   polling station is 422). Audited as `import.batch.create`.
2. `POST /v1/imports/batches/:id/files { files: [{ name, sizeBytes,
contentType? }] }` (`Idempotency-Key`) returns one upload per file with
   presigned **multipart** URLs into the private bucket (16 MiB parts). Only
   `.pdf` and `.zip`, up to `IMPORT_MAX_PDF_BYTES` / `IMPORT_MAX_ZIP_BYTES`
   (413 beyond). A part-level batch takes exactly one PDF, no ZIP. The browser
   PUTs each part and keeps the returned `ETag`s. Audited as
   `import.upload.start`.
3. `POST /v1/imports/batches/:id/files/:fileId/complete { parts: [{
partNumber, etag }] }` (`:fileId` is the upload's id) finishes it: the
   object must have the declared size and be a PDF (or a readable ZIP), then
   it is hashed (SHA-256) and becomes **one `import_file` per PDF**. A ZIP is
   unpacked on the server, with limits on entries, PDF size and total size;
   folders, hidden files and macOS metadata are ignored and anything else is
   listed in `skipped`. A PDF whose checksum matches a file already imported
   in the program is `duplicate` (with `duplicateOfId`) and isn't extracted;
   the rest are handed to the roll-parser (status `extracting`, see below). Completing again returns the same files; a file that
   fails the checks is 422 and the upload stays `failed`. Audited as
   `import.upload.complete`.

### Extraction (#45)

New files go to the **roll-parser worker** (`apps/roll-parser`) as BullMQ
`extract-roll` jobs on the `roll-extraction` queue (`ROLL_PARSER_QUEUE`,
`ROLL_PARSER_QUEUE_PREFIX`), one per file, with the file's id as the job id,
so a file is never queued twice. The contract is
`docs/design/roll-parser-contract.md`; jobs retry transient errors 3 times with
backoff. Files move `uploaded` → `extracting` → one of:

| Status         | When                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`        | header inside the batch's target, printed totals match the voters read, no row errors, and the worker didn't ask for review                                                                                         |
| `needs_review` | totals missing or different, a row with an error (e.g. age out of range), or the worker's own `needsReview` (low confidence)                                                                                        |
| `rejected`     | the cover page is for a place outside the batch's target (`header.outside_target`), unreadable (`header.incomplete`), its AC isn't in the master data (`header.ac_unknown`), or the PDF isn't a roll (`not_a_roll`) |
| `failed`       | the worker couldn't read the PDF (`pdf_unreadable`, `pdf_encrypted`, …) or the job kept failing (`extraction_failed`)                                                                                               |

For each result the API reads `result.v1.json` from the bucket and stores:

- on `import_file`: `detected_header` (`{ header, matching, issues,
pageImages, resultKey, workerVersion }`), `printed_totals`,
  `extracted_totals`, `quality_score`, `page_count`, `extraction_method`,
  `part_node_id` when the part already exists, `error` when rejected or
  failed;
- `matching`: the existing part (or `proposedPart` to create on confirm), the
  main and auxiliary stations (existing `nodeId`, or null to create), and
  `previousSourceVersionId` when the part already has a revision (confirming
  makes a new source version after it);
- one `import_row_result` per voter box: values and per-field confidence,
  raw text, and the issues as `messages` (`warning` status if any). On top of
  the worker's checks, the API flags an EPIC also listed in another part
  (`epic.duplicate_elsewhere`) and an unknown gender.

**Nothing is written to `household` or `voter`** until the file is confirmed
(#47). Each result is audited (`import.file.extracted`, counts and codes
only). The batch goes `processing` → `review` → `completed` (only
duplicates or failures: back to `uploading`). Results arrive through BullMQ
events; a sweep every `IMPORT_RESULTS_SWEEP_SECONDS` also picks up results the
API missed (e.g. while it was down) and re-sends files that never reached the
queue. A result is stored once, however often it is delivered, and its job
is removed afterwards.

Uploads are tracked in `import_upload` (the S3 multipart upload, declared
size, status); `import_file.upload_id` links each file to the upload it came
from. The bucket is `S3_BUCKET_IMPORTS` and is never public.

### Review (#46)

| Method  | Path                                | Returns                                                                          |
| ------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `GET`   | `/v1/imports/batches/:id`           | the batch and every file: status, part, pages, rows by status, voters, quality   |
| `GET`   | `/v1/imports/files/:id/preview`     | header, stations, issues, voter pages, totals check, and a page of rows          |
| `GET`   | `/v1/imports/files/:id/pages/:n`    | the JPEG of voter page `n` (`Cache-Control: private, no-store`)                  |
| `PATCH` | `/v1/imports/files/:id/rows/:rowId` | the row after the change: `{ values?: {...}, rejected?: bool, reason?: string }` |

Admins only, within their area (another area's batch or file is 404).

- **Voter count** = rows that would become active voters: not rejected, and
  not marked deleted on the roll.
- **Preview rows** are in roll order (page, box), `?limit=&cursor=`, with
  `total`. Filters: `status=accepted,warning,rejected` and `lowConfidence=true`
  (a field read below 0.6, the roll-parser's threshold, and not corrected
  since).
- **Totals check**: `printed`, `extracted` (as read), `current` (after
  corrections and rejections), `difference` (current − printed) and
  `matches`.
- **Page images**: only pages the roll-parser classified as voter pages, and
  only objects under that file's `extractions/<fileId>/` prefix. The cover,
  the maps/photos page and the summary are never served.
- **Corrections**: fields `epic`, `name`, `relationType`, `relativeName`,
  `houseNumber`, `age` (18–120), `gender`, `marker` (`deleted`, `modified` or
  null) and `sectionNumber`. They go to `corrected_values`; `extracted_values`
  never changes. Setting a field back to the extracted value removes its
  correction. `corrected_by`/`corrected_at` record who and when.
- **Re-validation**: extraction messages about a corrected field are marked
  `resolved`; a corrected EPIC that another row of the file has gets an
  `epic.duplicate` warning. A rejected row has a `row.rejected` message with
  the reason. The row is `rejected`, `warning` (something unresolved) or
  `accepted`.
- **File status after a change**: `ready` when the current counts match the
  printed totals and no row or header error is left, else `needs_review`
  (the batch follows). Only `ready` and `needs_review` files can be reviewed
  (409 otherwise).
- Each change is audited as `import.row.correct` with the file id, the field
  names and the rejection change, never the values.

### Rejections CSV (#48)

`GET /v1/imports/files/:id/rejections.csv` downloads the file's `rejected`
and `warning` rows (admins, within their area; audited as
`import.file.rejections_export` with the row count), in roll order. It is
streamed in batches of 500 rows.

- **Columns**: page, box, section, serial, status, the extracted values,
  `corrections` (`field=value; ...`) and `messages` (`code: text | ...`).
- **Formula safety**: every cell goes through `safeCsvCell()`
  (`src/common/csv.ts`). A value starting with `=`, `+`, `-`, `@`, a tab
  or a carriage return gets a leading `'`, so spreadsheet apps show it as
  text instead of running it (plan §8).
- **Encoding**: UTF-8 with a byte-order mark (for Telugu names in Excel),
  CRLF line ends, `Cache-Control: private, no-store`.

### Confirm (#47)

| Method | Path                              | Body / returns                                                                 |
| ------ | --------------------------------- | ------------------------------------------------------------------------------ |
| `POST` | `/v1/imports/files/:id/confirm`   | `{ acceptTotalsMismatch?: bool }` → `202 { id, status: "confirming", voters }` |
| `POST` | `/v1/imports/batches/:id/confirm` | → `202 { queued: [...], skipped: [{ id, code, message }] }`                    |

**Confirming a file** (admins, within their area):

- It must be `ready`, or `needs_review` with every row error dealt with.
  A file already `confirming` or `confirmed` gets 409.
- 422 when (`details.reason`):
  - `rows.unresolved`: a row still has an error, or misses its EPIC, section
    or serial;
  - `rows.duplicate_epic` / `rows.duplicate_serial`: listed twice;
  - `totals.mismatch`: the counts don't match the printed totals, unless
    `acceptTotalsMismatch` is set.

**Confirming a batch** confirms every `ready` file. Any that fail the checks
are listed in `skipped`. It is 422 if the batch has no ready file.

**The commit.** A confirmed file becomes `confirming`. A background job then
commits it in **one transaction per file**:

1. **Part and stations.** The part is linked, or created under the AC if it
   was proposed. The stations printed on the cover are linked or created (the
   auxiliary ones too); every part gets a main station.
2. **Source version.** A new `source_version` is added after the part's
   current one. The previous revision is kept, and its official voters become
   `superseded`.
3. **Households**, by house number (`houseKey`: "H NO 5-1" and "5-1" are the
   same house):
   - an existing household of the part is linked to the new revision, keeping
     what volunteers recorded;
   - official households the new revision no longer lists become `removed`;
   - volunteer-added households are never removed;
   - a voter without a house number gets a household of their own.
4. **Voters.** One per row that isn't rejected and isn't marked deleted on
   the roll. `source_data` holds the values with corrections applied, plus
   `corrected` (the corrected field names).
5. **Station of each voter.** The auxiliary station whose `coverage` (station
   metadata: `{ sections: [...] }` or `{ serials: { from, to } }`) includes
   the voter's section or serial, else the main station.
6. **Finish.** The file becomes `confirmed` (and the batch `completed` once
   nothing else is pending). The `NodeStatsRefresh` hook is asked to refresh
   the part and its stations; it only logs until #102.

**The queue** is the file's own status, claimed with
`FOR UPDATE SKIP LOCKED`:

- a confirm is never lost, and never committed twice, even with several API
  instances;
- files are picked up right away, and by a sweep every
  `IMPORT_RESULTS_SWEEP_SECONDS`;
- a commit that fails sends the file back to `needs_review` with `error`.

**Audit.** `import.file.confirm` records the admin; `import.file.committed`
is a system event with counts only (voters, households created, linked and
removed, voters superseded, rows skipped, and `carriedOver`).

### Carrying volunteer data over to the new record (#161)

When a new revision lists a voter with the same EPIC as an active voter of
the part's previous revision, the new record links to the old one
(`voter.previous_voter_id`). In the commit's transaction, so a failed commit
carries nothing:

- **Field values:** each current value is copied to the new record: same
  value, source, collector, collection time and consent, with
  `carried_from_id` pointing at the original. A consent-gated value is copied
  only while its consent is granted; a withdrawn consent is never revived.
  An open conflict is copied as a conflict, never resolved.
- **Consents:** consent rows are never rewritten. A consent given on an
  earlier record covers the voter's newer records (the API and the database
  check follow the link), and withdrawing it hides the values on every
  record.
- **Visits:** `visit_member` rows keep the record that was met.
  `GET /v1/voters/:id` returns `previousVoterIds` and `visitsMet` (visits
  that met the voter on any of their records), and sync pull sends
  `previousVoterIds` on each voter so the phone can do the same.
- **Superseded records don't change.** Their conflicts are no longer listed
  in sync, and a full sync snapshot leaves out their values. An offline edit
  or conflict resolution that still names the old record or its values is
  applied to the current record, through the carried copies. A base version
  that wasn't carried over (it was no longer current) makes the edit a
  conflict.
- An EPIC printed twice in either revision isn't linked. A voter with no
  EPIC match starts empty.
- **Not covered yet:** a voter whose EPIC moves to another part. That needs
  both parts' revisions and a later decision.
- Audited in `import.file.committed` as `carriedOver`: `votersLinked`,
  `valuesCarried`, `conflictsCarried` and `consentsCarried`. Counts only.

## Analytics: node_stats (#102)

Every geography node, from State down to polling station, has a row in
`node_stats` (design §7):

- `own`: what is counted at the node itself;
  - a station counts its voters, households, revision changes, data-quality
    figures and field work;
  - a part counts the import quality of its current revision;
- `metrics`: `own` plus the children's `metrics`. A parent always equals the
  sum of its children plus its own counts;
- `computed_at`.

**What is stored.** Only **raw, additive counts** (`RawMetrics` in
`src/analytics/metrics.ts`):

- electors by gender, and ages by single year;
- households, and large households (more than 10 voters);
- revision additions and deletions against the part's previous revision;
- extraction quality, rows extracted, corrected and rejected, duplicate
  EPICs, missing age or gender;
- field work: households assigned (stations with a volunteer) and visited,
  latest visit outcomes, voters met.

`derive()` computes the gender ratio, age bands, median age, voters per
household, average quality and visited share. `METRIC_DEFINITIONS` holds the
text for each metric. Small groups are suppressed by the analytics API
(#49), never in the table.

**Refreshing:**

- **Queue.** `NodeStatsRefresh.request(nodeIds, tx?)` queues nodes in
  `node_stats_request`, in the same transaction as the change.
  - Import confirm requests the part and its stations, and is picked up
    right away.
  - A visit requests its household's station, and is picked up within
    `ANALYTICS_REFRESH_SECONDS` (default 30).
- **Scope.** A refresh recomputes `own` for every part and station under
  the requested nodes. It then recomputes `metrics` for them and their
  ancestors, deepest first; nothing else is touched.
- **Concurrency.** The queue is drained with `FOR UPDATE SKIP LOCKED`, and
  refreshes run one at a time (advisory lock).
- **Full rebuild.** On start-up, an empty table is built in full. Otherwise
  run `pnpm --filter api stats:rebuild` (after `build`). Use it after
  changes the refresh doesn't follow yet, such as new volunteer
  assignments.

## Analytics API (#49)

Admins and campaign managers (`@Roles`), for any node in their area. A node
outside it, or above it, is 404.

| Method | Path                                                       | Returns                                                               |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET`  | `/v1/analytics/nodes/:id/summary`                          | `{ node, computedAt, minCohort, metrics, definitions }`               |
| `GET`  | `/v1/analytics/nodes/:id/children?metric=&order=asc\|desc` | `{ node, computedAt, total, average, children: [{ node, metrics }] }` |
| `GET`  | `/v1/analytics/nodes/:id/revisions`                        | `{ node, current: { additions, deletions, net }, versions: [...] }`   |

**Figures.** `metrics` is flat, with dotted keys:

- counts: `electors.total`, `electors.male`, `ages.18-19` … `ages.80+`,
  `ages.unknown`, `households.total`, `revisions.additions`,
  `quality.rowsCorrected`, `fieldWork.householdsVisited`,
  `fieldWork.outcomes.refused`, …;
- derived: `genderRatio`, `medianAge`, `votersPerHousehold`,
  `extractionQuality`, `visitedShare`, `revisions.net`.

Each figure is one of:

- a **number**. `0` is a real zero;
- **`"suppressed"`**: a group smaller than `ANALYTICS_MIN_COHORT` (default
  10), or one that could be worked out from the others;
- **`null`**: not collected. Examples: no earlier revision to compare
  with, no import quality data, no field work yet.

**Suppression** (`src/analytics/suppression.ts`), in order:

1. every count from 1 to cohort − 1 is suppressed;
2. within gender, age bands and visit outcomes, a single suppressed category
   would be the total minus the others, so the smallest other one is
   suppressed too;
3. across a node's children, the same rule applies against the parent's
   total. If no sibling can cover, the parent's figure in that table is
   suppressed instead;
4. derived figures are suppressed when a count they are built from is.

Steps 2 and 3 repeat until nothing changes. **A node's summary is its row
in its parent's children table**, so comparing the two calls can't undo a
suppression.

**Children table.** `average` gives counts as the parent's total ÷ the
number of children, and ratios as the parent's. `metric` sorts by any
figure: numbers first, then suppressed, then not collected.

**Revisions.** `versions` lists a part's source versions, with voters,
additions and deletions (additions and deletions are suppressed together).
Above part level, `versions` is empty and `current` gives the summed
changes.

## OpenAPI spec and typed client (#52)

`docs/api/openapi.json` (OpenAPI 3.1) describes every route. It is
generated, never edited by hand:

- **Requests** (paths, query parameters, bodies) come from the controllers
  and DTOs. The `@nestjs/swagger` CLI plugin (`nest-cli.json`) reads their
  types, validation decorators and doc comments at build time.
- **Responses** come from TypeScript types:
  - each route names its type with `@ApiResult('Name')`, or uses
    `@ApiNoBody()` or `@ApiFile(type)` (`src/openapi/api-result.ts`);
  - the type must be exported from `src/openapi/responses.ts`;
  - the export turns those types into JSON schemas with
    ts-json-schema-generator;
  - a route without a response type fails the export.
- **Also added by the export**:
  - bearer auth on every route except `@Public()` ones;
  - the `Idempotency-Key` header on `@Idempotent()` routes;
  - the error body (`ApiErrorBody`) as every route's default response.

Commands:

- `pnpm --filter api openapi` builds, then writes the file.
- `pnpm --filter api openapi:check` fails if the committed file is out of
  date. CI runs it in the JS job. The app is created in preview mode, so
  nothing connects to a database or Redis.

**When you add or change a route:** give it `@ApiResult`, run
`pnpm --filter api openapi` and `pnpm --filter @boothconnect/api-client
generate`, and commit both files.

**Swagger UI** is served at `/v1/docs` outside production. It shows the
committed spec, and the spec itself is at `/v1/docs/openapi.json`.

The typed client is `packages/api-client`, which the admin web uses through
`lib/api.ts`.

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

### Reading the log (#50)

`GET /v1/audit-events` (admins only) lists events newest first:
`?limit=&cursor=`, with the filters `actorId`, `action` (exact, or a prefix
ending in `*`, e.g. `import.*`), `resourceType`, `resourceId`, `result`, and
`from` / `to` (ISO 8601; `to` is exclusive). Each item has `seq` (a string),
`at`, the action, resource and result, `actor { id, name }`, the ids, the
redacted `metadata`, `prevHash` and `hash`.

- `nodeId` (#164) narrows to a booth or any area above it. It matches
  events about its households, members, visits, import files (by part) and
  import batches (by target), and events by volunteers who were assigned
  there when they happened (e.g. their sign-ins). Combine it with
  `actorId` for one volunteer in one booth.
- `verify=true` adds `verification: { checked, intact, firstBrokenSeq }`.
  It checks every event in the `from` / `to` range, whatever the other
  filters. Each event's hash is recomputed, and its `prev_hash` must equal
  the hash of the event just before it in the chain, so an edited, inserted
  or deleted event is found.
- Every read is recorded as `audit.view`, with the filters used, the number
  returned and the verification result.

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
