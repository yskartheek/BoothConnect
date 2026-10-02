# ADR-0007: A hash-chained, append-only audit log in the main database

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Product owner (yskartheek)
- **Related:** spec §14, plan §8 (Audit), #25 #34 #50 #76 #164 #167, `apps/api/src/audit/`

## Context

BoothConnect handles voter data during an election. Admins, auditors and,
if it ever comes to it, a court need to know who signed in, who viewed or
changed which record, who imported and confirmed which roll, and who
granted whom access. They also need to trust that this record hasn't been
quietly edited afterwards, including by someone with database access.

At the same time, the audit log must not become a second copy of the
personal data it protects.

## Decision

**Every significant action writes one event to `audit_event` in the same
transaction as the change. Each event is hashed together with the previous
event's hash, and the database refuses to change or delete events.**

- **What's recorded:** the action (e.g. `auth.login`, `auth.logout`,
  `visit.create`, `field.change`, `consent.capture`, `household.create`,
  `member.create`, `voter.view`, `voter.update`, `conflict.resolve`,
  `import.file.confirm`, `role.grant`, `audit.view`). Also the actor, their
  session, the request ID, the resource type and ID, the result (success or
  failure), the time, and metadata.
- **No personal data.** Metadata is for ids, counts and reason codes. Before
  it is stored, `redact()` replaces the values of sensitive keys
  (credentials and codes; names, phones, addresses, EPIC, age, gender,
  caste, religion…) with `[REDACTED]`. Failed sign-ins record the reason
  code, never the phone or the code.
- **Same transaction.** `AuditService.record(entry, tx)` runs inside the
  write it describes, so an action and its event are committed together or
  not at all. `@Audited()` covers simple endpoints.
- **Hash chain, in the database.** A `BEFORE INSERT` trigger takes an
  advisory lock, reads the last event's hash, and sets `prev_hash` and
  `hash = sha256(prev_hash | canonical JSON of the event)`. The JSON is
  built by the database with fixed key order and the time in epoch
  microseconds, so it doesn't depend on settings. The lock makes concurrent
  writers form one linear chain, and `seq` orders it.
- **Append-only, in the database.** Triggers refuse `UPDATE`, `DELETE` and
  `TRUNCATE` on `audit_event`, for every write, the API's included (tested
  in `audit-idempotency.int-spec.ts`). Only a role allowed to alter the table can turn
  the triggers off. In production, the API should connect as a role that
  can't (see Consequences).
- **Verification.** `audit_verify_chain()` recomputes the chain and
  returns the first broken `seq`, or null. Admins can verify a time range
  from the audit explorer (`GET /v1/audit-events?verify=true`); the check
  includes the link to the event just before the range.
- **Reading the log** is itself audited (`audit.view`), admin-only, scoped
  by area (#164).

## Alternatives considered

| Option                                                             | Why not                                                                                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application logs only                                              | Not transactional with the change, easy to lose or rotate away, and log lines can be edited or dropped without trace.                                                              |
| Hash computed in the API                                           | Two API instances would race to link to the same previous event and fork the chain. The database is the one place that can serialise inserts in commit order.                      |
| An external append-only store (e.g. a ledger service, WORM bucket) | Not in the same transaction as the change, and another service to run. Worth adding later as a copy (see Consequences), not as the primary log.                                    |
| Store the changed values in the event                              | Duplicates personal data into a table that can't be deleted, which conflicts with retention and erasure rules. The values live in `field_value` with their own history (ADR-0005). |

## Consequences

- Every insert takes the chain lock briefly, so audit writes are
  serialised. That's fine at Milestone 1 volumes. If it ever becomes a
  bottleneck, shard the chain (e.g. per program) or batch the hashing.
- **The chain detects edits, insertions and deletions in the middle.** It
  can't, on its own, detect someone who can alter the table (its owner, a
  superuser) disabling the triggers and cutting events off the **end**.
  Before production: run migrations as the owner, and the API as a role
  without `ALTER` rights on `audit_event`. Closing that gap means
  regularly writing the latest hash somewhere outside the database (a
  signed export, a separate store). That's a follow-up before production.
- The log can't be purged row by row. Retention (an open decision, plan §11)
  will need a documented archive-and-rotate procedure that starts a new
  chain from a signed checkpoint.
- Redaction is by key name. A new metadata field with personal data under
  an unexpected key would be stored. Reviews check that metadata holds ids,
  counts and codes only (PR checklist), and `redact.spec.ts` covers the
  known keys.
