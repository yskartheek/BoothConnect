# #80: ADRs for the key Milestone 1 decisions

**Issue:** https://github.com/yskartheek/BoothConnect/issues/80
**What changed:** five architecture decision records in [`docs/adr/`](../adr/README.md). They're numbered after the three that already exist (the issue's ADR-002 to ADR-006 are 0004 to 0008 here):

| ADR                                                   | Decision                                                                                                                                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0004](../adr/0004-geography-scope-and-404.md)        | Scope is resolved on every request and every query is limited to it. A record outside it is a 404, never a 403.                                                                                                        |
| [0005](../adr/0005-official-data-and-field-values.md) | The official roll record is frozen at import. Everything else is an append-only field value with who, when, how and under which consent, and it's carried over to a new roll revision.                                 |
| [0006](../adr/0006-offline-sync-protocol.md)          | Pull with a transaction-snapshot cursor. Push mutations, each with its own idempotency key and result (applied, duplicate, conflict, rejected). Conflicts are detected with `base_version`, and the volunteer chooses. |
| [0007](../adr/0007-hash-chained-audit-log.md)         | Audit events are written in the same transaction, hash-chained by the database, and can't be changed or deleted. No personal data goes into them.                                                                      |
| [0008](../adr/0008-restricted-fields.md)              | Restricted fields are off by default. The database refuses to enable one without consent and a legal basis, and refuses a value without a granted consent from that person.                                            |

Each follows the template: context, decision, alternatives considered, consequences. Each points to the code and tests that enforce it.

## Steps

1. Open `docs/adr/README.md`.
   **Expect:** ADRs 0001 to 0008 listed, all Accepted.
2. Read each new ADR.
   **Expect:** you can tell what was decided, why, what else was considered, and what it costs, without reading the code.
3. Check the follow-ups named under **Consequences**, and whether you agree they block production:
   - 0007: anchor the latest audit hash outside the database; the API's database role without `ALTER` on `audit_event`;
   - 0008: the spec §22 legal review for caste/community;
   - 0004: per-assignment roles if a user ever holds different roles in different areas.

## Pass criteria

- The five decisions match how you want BoothConnect to work. If one doesn't, it can be superseded by a new ADR.

## Known issues and notes

- The ADRs record decisions already implemented in Milestone 1, so they're **Accepted**, dated when written.
