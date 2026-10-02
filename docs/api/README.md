# BoothConnect API

The rules every client needs: sign-in, errors, idempotency, sync, pagination
and booth scope. Each endpoint's request and response shapes are in
[`openapi.json`](openapi.json), and in Swagger UI at **`/v1/docs`** on any
API that isn't running in production. The typed client in
`packages/api-client` is generated from the same file.

- Base URL: `http://localhost:4000/v1` locally (the API listens on
  `API_PORT`; every path starts with `/v1`). From the Android emulator, the
  host is `10.0.2.2`.
- Requests and responses are JSON, apart from the uploads and CSV exports
  noted in the spec. Times are ISO 8601 in UTC, e.g.
  `2026-09-30T04:25:12.345Z`. IDs are UUIDs.
- Every response has an `X-Request-Id` header. Send your own (up to 128
  letters, digits, `.`, `_`, `:` or `-`) to trace a request. Otherwise the
  API makes one.

## Contents

1. [Quick start: sign in and sync](#quick-start-sign-in-and-sync)
2. [Signing in](#signing-in)
3. [Errors](#errors)
4. [Booth scope and 404](#booth-scope-and-404)
5. [Idempotency](#idempotency)
6. [Sync](#sync)
7. [Pagination](#pagination)
8. [Endpoints](#endpoints)
9. [Changing the API](#changing-the-api)

## Quick start: sign in and sync

With the API running against the development seed (see
[SETUP.md](../SETUP.md)) and `OTP_DEV_MODE=true`, which writes sign-in
codes to the API's log instead of sending an SMS. The phone is Demo
Volunteer A's.

```bash
API=http://localhost:4000/v1
uuid() { node -e 'console.log(crypto.randomUUID())'; }   # or uuidgen

# 1. Ask for a sign-in code. Always 202, registered phone or not.
curl -s -X POST $API/auth/otp/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+919999900002"}'

# 2. Read the code from the API's log:
#    "Development sign-in code for +919999900002: 123456"
CODE=123456

# 3. Exchange it for tokens. deviceId: a stable id of this installation.
curl -s -X POST $API/auth/otp/verify \
  -H 'content-type: application/json' \
  -d "{\"phone\":\"+919999900002\",\"code\":\"$CODE\",\"deviceId\":\"docs-example\"}"
# → {"accessToken":"…","refreshToken":"…","tokenType":"Bearer","expiresIn":900}
TOKEN=…   # accessToken

# 4. Who am I, and which booths are mine?
curl -s $API/me -H "authorization: Bearer $TOKEN"

# 5. Download everything for my booths (a full snapshot).
curl -s "$API/sync/pull?limit=500" -H "authorization: Bearer $TOKEN"
# → {"reset":true,"households":[…],"voters":[…],…,"hasMore":false,"cursor":"…"}

# 6. Upload a visit recorded offline. HOUSEHOLD is one of the pulled
#    households' ids; the uuids are made by the client.
curl -s -X POST $API/sync/push \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuid)" \
  -d '{"mutations":[{"key":"'"$(uuid)"'","type":"visit.create","payload":{
        "clientId":"'"$(uuid)"'","householdId":"'"$HOUSEHOLD"'",
        "startedAt":"2026-09-30T10:00:00.000Z","completedAt":"2026-09-30T10:05:00.000Z",
        "outcome":"no_one_available","formVersion":"1","memberIdsMet":[]}}]}'
# → {"results":[{"key":"…","type":"visit.create","status":"applied","result":{…}}]}

# 7. Next time, download only what changed since: pass the last cursor.
curl -s "$API/sync/pull?since=$CURSOR" -H "authorization: Bearer $TOKEN"
```

Codes can be requested 3 times per phone in 10 minutes. After that,
`otp/request` answers **429** until the window ends.

The same in PowerShell (Windows):

```powershell
$api = "http://localhost:4000/v1"
$json = "application/json"

Invoke-RestMethod -Method Post -Uri "$api/auth/otp/request" -ContentType $json -Body '{"phone":"+919999900002"}'
$code = Read-Host "Code (from the API log)"
$t = Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType $json `
  -Body (@{ phone = "+919999900002"; code = $code; deviceId = "docs-example" } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($t.accessToken)" }

Invoke-RestMethod "$api/me" -Headers $h
$page = Invoke-RestMethod "$api/sync/pull?limit=500" -Headers $h

$visit = @{ mutations = @(@{
  key = [guid]::NewGuid().ToString(); type = "visit.create"
  payload = @{
    clientId = [guid]::NewGuid().ToString(); householdId = $page.households[0].id
    startedAt = "2026-09-30T10:00:00.000Z"; completedAt = "2026-09-30T10:05:00.000Z"
    outcome = "no_one_available"; formVersion = "1"; memberIdsMet = @()
  }
}) } | ConvertTo-Json -Depth 5
$push = $h + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }
(Invoke-RestMethod -Method Post -Uri "$api/sync/push" -Headers $push -ContentType $json -Body $visit).results

Invoke-RestMethod "$api/sync/pull?since=$([uri]::EscapeDataString($page.cursor))" -Headers $h
```

## Signing in

Sign-in uses a one-time code sent to the user's phone. There are no
passwords.

| Step            | Call                                              | Notes                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask for a code  | `POST /auth/otp/request` `{phone}`                | `phone` in international format (`+919876543210`). Always **202**, so it can't be used to find out which phones are registered. A code lasts 5 minutes. More than 3 requests for one phone in 10 minutes → **429 `RATE_LIMITED`**.                 |
| Sign in         | `POST /auth/otp/verify` `{phone, code, deviceId}` | Returns the token pair. A wrong or expired code → **401 `OTP_INVALID`**. After 5 wrong attempts the code is locked (**401 `OTP_LOCKED`**): ask for a new one. `deviceId` names the app installation the session belongs to.                        |
| Call the API    | `Authorization: Bearer <accessToken>`             | The access token lasts 15 minutes (`expiresIn`, in seconds). Missing, expired or revoked → **401 `UNAUTHENTICATED`**. A suspended user's token stops working on the next request.                                                                  |
| Get a new token | `POST /auth/refresh` `{refreshToken}`             | Returns a **new pair**: the refresh token rotates on every use, and the old one stops working. Presenting an already-used refresh token signs that device out (it was copied). A session lasts 30 days from sign-in, however often it's refreshed. |
| Sign out        | `POST /auth/logout` (with the access token)       | **204**. The session and both tokens stop working.                                                                                                                                                                                                 |

Refresh when a call returns 401 (or just before `expiresIn` runs out), then
retry the call once. If the refresh fails too, the user has to sign in
again. Keep tokens in the platform's secure storage. The mobile app uses
`flutter_secure_storage`.

`GET /me` returns the user and their current role assignments: `role`
(`volunteer`, `admin`, `campaign_manager`) and the geography `node` it
covers, with the path from the state down. A volunteer's node is usually a
polling station (a booth).

### Voter sign-in

Voters sign in with their **voter ID (EPIC)** and a code sent to the **mobile
number on their record** (one a volunteer collected):

| Step           | Call                                                          | Notes                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask for a code | `POST /voter-auth/otp/request` `{epic, phone}`                | Always **202**. A code is sent only when one active voter has that EPIC (spaces and case don't matter) **and** `phone` is their current mobile number. Rate-limited per phone and per EPIC, whether they match or not. |
| Sign in        | `POST /voter-auth/otp/verify` `{epic, phone, code, deviceId}` | The usual token pair. A wrong code, an unknown EPIC and a phone that isn't on the record are all **401 `OTP_INVALID`**. The first sign-in creates the phone's user.                                                    |

Refresh and sign-out are the same as for staff. A voter's session acts for
that voter record only:

- `GET /me` has `voter: {id}` and no `assignments`;
- it has the `voter` role and **no booths**, so booth-scoped endpoints return
  nothing and staff endpoints are 403;
- this holds even when the same phone belongs to a volunteer or an admin:
  their own sign-in keeps their staff rights.

### The voter's own record

With a voter's session (and only then; staff get 403), under `/voter/me`.
The voter is always the session's, so no request names a voter:

| Call                                                      | What it does                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /voter/me`                                           | The official roll data (`official`: name, relation, age, gender, house number), EPIC, section and serial, part, booth, program, household address, and `shared`: mobile number, occupation and additional info, each with its `fieldValueId` (or null). Audited (`voter.self_view`).                                                    |
| `PATCH /voter/me/details` + Idempotency-Key               | `{fields: [{fieldKey, value, baseVersion}]}`. Each shared detail becomes the current value at once, as `voter_self_submitted`, or a `conflict` if it changed since `baseVersion`. Official details and restricted fields are `rejected` with `FORBIDDEN`. One result per detail. Audited (`voter.self_update`, keys and outcomes only). |
| `GET /voter/me/updates`                                   | Newest first: changes to the voter's details (which detail and by whom: `you`, `volunteer` or `admin`; never the values, never restricted details), visits to their household (outcome; a corrected visit shows as corrected), and when they joined.                                                                                    |
| `GET /voter/me/consents`                                  | The consents the voter gave (purpose and its field's `labelKey`, notice version, method, when, status), newest first.                                                                                                                                                                                                                   |
| `POST /voter/me/consents/{id}/withdraw` + Idempotency-Key | Withdraws one: the values it covers stop being shown and synced at once, and volunteers' phones delete them on their next pull (`removedFieldValueIds`). Withdrawing again returns it unchanged. Another person's consent is 404. Audited (`consent.withdraw`).                                                                         |

If a newer roll replaced the voter's record, these follow it to the new one.
A voter no longer on the roll gets 404.

### Staff: a voter's consents

A voter can also ask their volunteer, or an admin, to withdraw a consent
for them (#213). With a volunteer's or admin's session, for a voter in
their booths (404 otherwise):

| Call                                                                | What it does                                                                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /voters/{id}/consents`                                         | The voter's consents, newest first, as for the voter, plus `capturedBy` and `withdrawnBy` (`{id, name}` or null).                                                       |
| `POST /voters/{id}/consents/{consentId}/withdraw` + Idempotency-Key | Withdraws it, as when the voter does it themselves: the covered values stop being shown and synced at once. Audited (`consent.withdraw`, `by`: `volunteer` or `admin`). |

A value recorded later for the same field needs a new consent; it then
replaces the hidden value instead of conflicting with it.

Try it with the development seed's demo voter (`DMO1000001`, mobile
`+919999900101`):

```bash
API=http://localhost:4000/v1
curl -s -X POST $API/voter-auth/otp/request -H 'Content-Type: application/json' \
  -d '{"epic":"DMO1000001","phone":"+919999900101"}'
# The code is in the API's log: "Development sign-in code for +919999900101: 123456"
TOKEN=$(curl -s -X POST $API/voter-auth/otp/verify -H 'Content-Type: application/json' \
  -d '{"epic":"DMO1000001","phone":"+919999900101","code":"123456","deviceId":"curl"}' \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
curl -s $API/voter/me -H "Authorization: Bearer $TOKEN"
# → {"id":"…","epicNumber":"DMO1000001","official":{…},…,"shared":[{"key":"mobile_number",…}]}
curl -s $API/voter/me/consents -H "Authorization: Bearer $TOKEN"
# → {"items":[{"id":"…","purpose":"caste_community","status":"granted",…}]}
```

[ADR-0009](../adr/0009-voter-accounts-and-verification.md) explains why voters
sign in this way.

## Errors

Every error has the same body:

```json
{
  "requestId": "6f1c…",
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "details": [{ "field": "address.pin_code", "errors": ["pin_code must be 6 digits"] }]
}
```

- **Branch on `code`, never on `message`.** Codes are never renamed.
  Messages are for people and may change.
- `requestId` matches the `X-Request-Id` header and the API's log. Quote
  it when reporting a problem.
- `details` is optional. For `VALIDATION_FAILED` it lists each invalid
  field by its dotted path. The values you sent are never echoed back,
  because they may be personal data.
- Unknown properties are rejected (`VALIDATION_FAILED`), not silently
  dropped, so a misspelt field isn't lost without notice.
- 5xx errors carry no internals: `INTERNAL_ERROR` ("Quote the request ID if
  you report it") or `SERVICE_UNAVAILABLE`.

| Status | Codes                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`, `MALFORMED_JSON`, `BAD_REQUEST` (e.g. an invalid cursor), `IDEMPOTENCY_KEY_REQUIRED` |
| 401    | `UNAUTHENTICATED`, `OTP_INVALID`, `OTP_LOCKED`                                                            |
| 403    | `FORBIDDEN`: your role can't use this endpoint at all                                                     |
| 404    | `NOT_FOUND`: no such record, **or it's outside your booths** (see below)                                  |
| 409    | `CONFLICT`, `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `IDEMPOTENCY_IN_PROGRESS`                        |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                       |
| 415    | `UNSUPPORTED_MEDIA_TYPE`                                                                                  |
| 422    | `UNPROCESSABLE`, `IDEMPOTENCY_KEY_REUSED`                                                                 |
| 429    | `RATE_LIMITED`                                                                                            |
| 500    | `INTERNAL_ERROR`                                                                                          |
| 503    | `SERVICE_UNAVAILABLE`                                                                                     |

Field writes (a member's or household's details, in `PATCH /voters/{id}`,
`PATCH /households/{id}` and sync push) can also report, per field:
`FIELD_UNKNOWN`, `FIELD_DISABLED` (the admin turned it off),
`CONSENT_REQUIRED` (caste/community without a consent record),
`INVALID_VALUE` and `BASE_VERSION_INVALID`.

## Booth scope and 404

Each user sees only the data of the geography they're assigned to: a
volunteer sees their booth, and an admin sees everything below their node.

- **A record outside your scope is a 404**, exactly like one that doesn't
  exist. It's never a 403, so record IDs can't be probed.
- Lists, counts and sync never include records outside your scope.
- **403 `FORBIDDEN`** means your role can't use the endpoint at all, e.g. a
  volunteer calling `/imports` or `/users`.
- Analytics (`/analytics/nodes/…`) hide groups of fewer than 10 people,
  including any that could be worked out by subtracting from a total.

The rule is tested endpoint by endpoint in
`apps/api/test/cross-booth.int-spec.ts`.

## Idempotency

A phone retries whatever didn't get an answer, so every write that creates
or changes data must be safe to send twice.

**Writes need an `Idempotency-Key` header.** These are `POST /visits`,
`POST /sync/push`, `POST|PATCH /households…`, `PATCH /voters/{id}` and the
admin writes. The spec marks each one with the header.

- The key is 8–128 letters, digits, `-` or `_`. A UUID works.
- Use **one key per logical change**, and send **the same key on every
  retry** of it. Make the key when the change is made, not when it's sent.
- A retry with the same key and the same body returns the first response
  (with `Idempotency-Replayed: true`), and nothing is written again.
- The same key with a different body → **422 `IDEMPOTENCY_KEY_REUSED`**.
- A retry while the first is still running waits up to 5 s for its answer,
  then → **409 `IDEMPOTENCY_IN_PROGRESS`**: try again shortly.
- Only successful responses are kept, so a failed request can be retried
  with the same key. Responses are kept for 7 days, long enough for a
  phone that was offline for days.
- Keys are per user: two users can't collide.

Records created offline also carry an id the client made: a visit's
`clientId`, and the `id` of a household, member or consent. Sending the
same one again returns the existing record, even under a new key.

## Sync

Phones work offline. They download their booths' data, record visits and
edits locally, and upload them when they're back online.

### Pull: `GET /sync/pull?since=&limit=`

- **No `since`:** a full snapshot. The first page has `reset: true`:
  **replace everything stored on the device**. Every page of a snapshot
  says `reset`, so clear only on the first one.
- **`since=<cursor>`:** only what changed after that pull (new rows, and
  rows whose values changed).
- **`hasMore: true`:** call again straight away with `since=cursor`.
  **`hasMore: false`:** keep `cursor` for the next pull.
- `limit`: rows per page across all record types (default 500, max 2000).
- Each page has `fieldDefinitions`, `households`, `voters`, `fieldValues`
  and `visits`. Upsert each by `id`. A household with `status: removed`,
  or a voter whose `recordStatus` isn't `active`, leaves the list.
- The **last page** also has:
  - `removedFieldValueIds`: values whose consent was withdrawn. Delete
    them.
  - `conflicts`: every open conflict on your booths, with both values.
- A field definition with `enabled: false` is no longer collected: hide it
  and its values.
- Restricted fields (`isRestricted`, e.g. caste/community) are for
  authorised staff. The mobile app never keeps their values.
- The cursor is opaque. It can be long on a busy database, so send it as
  the query parameter and don't truncate it.

### Push: `POST /sync/push`

```json
{
  "mutations": [
    { "key": "<uuid>", "type": "visit.create", "payload": { … } },
    { "key": "<uuid>", "type": "field.change", "payload": { … } }
  ]
}
```

- Up to **200 mutations** per request, applied **in order**, each on its
  own. A bad item doesn't stop the others. The request still needs an
  `Idempotency-Key` header. The mobile app uses a hash of the batch, so a
  resent batch gets the same key.
- Each mutation's `key` is its own idempotency key. Keep it with the
  queued change and reuse it on every retry, in this batch or a later one.
- Later items may refer to records that earlier items create, through the
  ids the client made (a new household, then its members, then a visit).
- `type` and its `payload`:

| `type`             | Payload (see `PAYLOADS` in the spec / `push.dto.ts`)                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visit.create`     | `clientId`, `householdId`, `startedAt`, `completedAt`, `outcome`, `formVersion`, `memberIdsMet`, optional `notes`                                                     |
| `field.change`     | `entityType` (`voter` / `household`), `entityId`, `fieldKey`, `value`, `baseVersion`, optional `consentId`, `collectedAt`                                             |
| `consent.capture`  | `id`, exactly one of `voterId` / `householdId`, `purpose` (a field key, or `household_location`), `noticeVersion`, `method` (`in_person_verbal` / `in_person_signed`) |
| `household.create` | `id`, `pollingStationId` (one of your booths), `address {house_no, street, area, pin_code, landmark}`, optional `location`                                            |
| `household.update` | `id`, `address` + `addressBaseVersion` and/or `location` + `locationBaseVersion`. A location is `{lat, lng, accuracyM, capturedAt, consent: {noticeVersion, method}}` |
| `member.create`    | `householdId`, `id`, `name`, optional `age`, `gender`, `fields: [{fieldKey, value, consentId?}]`                                                                      |
| `conflict.resolve` | `conflictId` (either value of the conflict), `keepFieldValueId`                                                                                                       |

**The response has one result per mutation, in the same order**:
`{"results": [{key, type, status, …}]}`. There are four result types:

| `status`    | Meaning                                                                                                                                   | What the client does                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `applied`   | Stored. `result` holds the record, e.g. the server's `fieldValueId` for a value.                                                          | Remove it from the queue. Give the local copy the server's ids.                                                  |
| `duplicate` | Already stored (a resent key, or a record with this client id exists). `result` is what it was.                                           | Same as `applied`.                                                                                               |
| `conflict`  | Stored, but someone else changed the same field since `baseVersion`. Both values are kept and current. `current` has the server's values. | Ask the user which to keep, then send `conflict.resolve`. Neither value is lost: the other stays in the history. |
| `rejected`  | Nothing stored: `code`, `message`, maybe `details`. E.g. `VALIDATION_FAILED`, `NOT_FOUND`, `CONSENT_REQUIRED`.                            | Keep it and show the reason. It usually needs a change before it can succeed.                                    |

A network error, a 5xx, or a batch with no answer: retry the whole batch
later, with the same keys. The mobile app backs off from 2 s, doubling up to
5 minutes, with jitter.

**`baseVersion`** is the id of the value the client last saw for that
field, or `null` if it saw none. It's how the server tells a normal edit
from one made while someone else changed the same field. When a batch
creates a value and a later change is based on it, wait for the first
result's server id before sending the second.

## Pagination

Lists (`/households`, `/users`, `/geographies`, `/audit-events`, an
import file's `/preview`) use cursors:

- `?limit=` (default 50, max 200) and `?cursor=`.
- The response is `{ "items": [...], "nextCursor": "…" | null }`. Pass
  `nextCursor` as `cursor` for the next page. `null` means this is the last
  page.
- Cursors are opaque. A changed or made-up cursor → **400 `BAD_REQUEST`**.

Sync pull has its own paging (`since` / `cursor` / `hasMore`, above).

## Endpoints

Grouped by tag, as in Swagger UI. The role column is who may call each
group; "signed in" means any role. Everything returns only what's in the
caller's scope.

| Tag                | Endpoints                                                                                                                              | Roles                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Health             | `GET /health`                                                                                                                          | anyone (no token)           |
| Auth               | `POST /auth/otp/request`, `/auth/otp/verify`, `/voter-auth/otp/request`, `/voter-auth/otp/verify`, `/auth/refresh`, `/auth/logout`     | anyone; logout with a token |
| Me                 | `GET /me`                                                                                                                              | any signed-in user          |
| Sync               | `GET /sync/pull`, `POST /sync/push`                                                                                                    | volunteer, admin            |
| Households         | `GET /households`, `GET /households/{id}`                                                                                              | signed in                   |
|                    | `POST /households`, `PATCH /households/{id}`, `POST /households/{id}/members`                                                          | volunteer, admin            |
| Voters             | `GET /voters/{id}`                                                                                                                     | signed in                   |
|                    | `PATCH /voters/{id}`                                                                                                                   | volunteer, admin            |
|                    | `GET /voters/{id}/consents`, `POST /voters/{id}/consents/{consentId}/withdraw`                                                         | volunteer, admin            |
| Visits             | `POST /visits`                                                                                                                         | volunteer, admin            |
| Voter self-service | `GET /voter/me`, `PATCH /voter/me/details`, `GET /voter/me/updates`, `GET /voter/me/consents`, `POST /voter/me/consents/{id}/withdraw` | a voter's session           |
| Conflicts          | `POST /conflicts/{id}/resolve`                                                                                                         | volunteer, admin            |
| Imports            | `/imports/batches…`, `/imports/files…` (roll upload, review, confirm, rejections CSV)                                                  | admin                       |
| Geographies        | `/geographies…` (the hierarchy, stations, coverage, master import)                                                                     | admin                       |
| Users              | `/users…`, `/role-assignments…`                                                                                                        | admin                       |
| Audit              | `GET /audit-events`                                                                                                                    | admin                       |
| Analytics          | `GET /analytics/nodes/{id}/summary`, `/children`, `/revisions`                                                                         | admin, campaign_manager     |

## Changing the API

The spec is generated from the controllers and DTOs, and committed:

```bash
pnpm --filter api openapi          # rewrite docs/api/openapi.json
pnpm --filter api openapi:check    # CI: fails if it's out of date
pnpm --filter @boothconnect/api-client generate   # regenerate the typed client
```

A new or changed endpoint that's scoped to booths or areas also needs a
row in `ROUTES` in `apps/api/test/cross-booth.int-spec.ts`.

A new query parameter is logged as `[redacted]` until it's added to
`LOGGABLE_QUERY_PARAMS` in `apps/api/src/config/logger.ts`; add it only if
its values are IDs, codes, dates, numbers or flags, never free text (#210).
Path parameters are logged, so they must be IDs.
