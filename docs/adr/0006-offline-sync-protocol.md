# ADR-0006: Offline sync: idempotency keys, base-version conflicts and per-item results

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Product owner (yskartheek)
- **Related:** ADR-0003, ADR-0005, plan §4–§5, #35 #42 #43 #61 #66 #67 #68, `docs/api/README.md` (Sync)

## Context

Volunteers work door to door, often with no signal. The app has to:

- show the booth's households and members with no connection;
- save visits and edits on the phone at once, and upload them later, after
  hours or days and across app restarts;
- never lose or double a change when a request times out and is retried,
  or when the answer is lost;
- notice when two people changed the same detail while offline, and keep
  both values.

Uploads go over flaky mobile networks, so any request may be sent several
times, and some answers never arrive.

## Decision

**Pull with an opaque snapshot cursor. Push a queue of mutations, each with
its own idempotency key and its own result. Detect conflicts with the
value each edit was based on.**

### Pull: `GET /v1/sync/pull?since=<cursor>`

- No cursor: a **full snapshot** (`reset: true`). With a cursor: only rows
  changed since then.
- Every synced table has a `change_xid` column: the Postgres transaction
  ID that last wrote the row, set by the database. The cursor records which
  transactions the previous pull could see (`xmax` and the ones still
  running). The next pull sends exactly the rows written by transactions it
  couldn't see. Long-running or concurrent transactions are never skipped,
  which a timestamp cursor can't promise.
- Pages are bounded by `limit` (`hasMore` → call again at once). The last
  page also carries the open conflicts and the values whose consent was
  withdrawn.
- The cursor includes a fingerprint of the caller's scope (ADR-0004). A
  changed scope restarts with a full snapshot, so the phone drops what it
  can no longer see.

### Push: `POST /v1/sync/push`

- The phone queues each change in its own `pending_mutation` table, in the
  same transaction as the local write, with a **key made when the change is
  made**. The key is reused on every retry.
- A push sends up to 200 mutations in order (`visit.create`,
  `field.change`, `consent.capture`, `household.create`, `household.update`,
  `member.create`, `conflict.resolve`). Each is applied in **its own
  transaction**, and gets **its own result**:
  - `applied`: stored;
  - `duplicate`: already stored under this key (or a record with this
    client-made id exists). The result is what it was;
  - `conflict`: stored, but the field had moved on (see below);
  - `rejected`: nothing stored, with a code (validation, not found, consent
    required…).

  One bad item never fails the batch.

- **Two levels of idempotency.** The request carries an `Idempotency-Key`
  (#35; the app uses a hash of the batch), so a resent batch replays the
  first answer. Each item's key is stored for 7 days, so the same change in
  a later, different batch is a `duplicate` and is not applied twice.
- **Client-made ids.** Visits, households, members and consents carry an id
  the phone made, so later items in the same batch, and later edits
  offline, can refer to them before the server has seen them.

### Conflicts: `base_version`

- Every edit says which value the phone last saw for that field
  (`baseVersion`, or null for none). If the field's current value is still
  that one, the edit supersedes it.
- If someone else's value has become current meanwhile, the edit is **stored
  anyway** and both are current, linked by `conflict_with_id`. The item's
  result is `conflict`, with the current values. No value is lost.
- The volunteer chooses on the phone (**Choose value**), which sends
  `conflict.resolve`. The other value stays in the history (ADR-0003,
  ADR-0005).

### Phone behaviour (`apps/mobile`)

- Retries back off: 2 s, doubling to at most 5 minutes, with jitter. They
  start on connectivity changes, app resume, sign-in and after each save.
- A change based on a value made earlier in the same batch waits for that
  value's server id (the next batch), so `baseVersion` is always a server
  id.
- Status words for volunteers: On phone, Uploading, Uploaded, Choose value,
  Not uploaded.

## Alternatives considered

| Option                                           | Why not                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updated_at` timestamp cursor                    | Misses rows written by a transaction that started earlier but committed later than the last pull, and is sensitive to clock skew. Transaction IDs don't have either problem.          |
| All-or-nothing batch                             | One invalid item (a deleted household, a field turned off) would block every change behind it, forever.                                                                               |
| Last write wins                                  | Silently drops a volunteer's change, which the spec forbids.                                                                                                                          |
| Field-level CRDTs / automatic merge              | The values are free text, numbers and choices; there's no meaningful merge of two mobile numbers. A person should choose, and conflicts are rare (one volunteer per booth, normally). |
| Request-level idempotency only                   | A change that went in one batch and is retried in another (after the queue was reordered or partly applied) would be applied twice.                                                   |
| Third-party sync service (e.g. a hosted backend) | Puts personal data in another service, and doesn't know the consent and scope rules.                                                                                                  |

## Consequences

- Every synced table needs `change_xid` and an index on it. A new synced
  record type needs a pull phase and, if the phone writes it, a push type.
- Item keys and their results are kept for 7 days
  (`IDEMPOTENCY_TTL_SECONDS`). After that, a resent change is still
  recognised by its client-made id (visits, households, members, consents).
  A resent field change is stored again, and since its `baseVersion` is no
  longer current, it comes back as a conflict for the volunteer, not as a
  silent overwrite.
- The cursor can grow when many transactions are running at once (it lists
  them). It's capped (500 running transactions, 12,000 characters).
- Conflicts need a screen on the phone (Uploads → Choose value) and stay
  open on the server until someone chooses.
- The protocol is covered end to end: API integration tests for replays and
  conflicts, and the mobile test that records a visit offline, restarts the
  app, reconnects and sees it synced (#68).
