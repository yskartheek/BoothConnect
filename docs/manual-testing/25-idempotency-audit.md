# #25: Schema for idempotency records and the append-only audit log

**Issue:** https://github.com/yskartheek/BoothConnect/issues/25
**What changed:**

- New tables (migration `…_idempotency_audit`):
  - `idempotency_record`: for writes sent with an `Idempotency-Key` header:
    the user, the key (unique per user), a SHA-256 of the request, and the
    stored response and status. A retried upload gets the same response
    instead of being applied twice. Records expire (a cleanup job comes
    later).
  - `audit_event`: who did what, to which record, with what result
    (`success` / `denied` / `failure`), the request ID (to find the matching
    log lines), time and metadata
- **The database builds the hash chain itself:** on every insert it assigns
  the next sequence number, stores the previous event's hash, and computes
  this event's SHA-256. This holds even for events written by raw SQL.
- **The audit log can't be changed:** `UPDATE`, `DELETE` and `TRUNCATE` on
  `audit_event` are refused.
- `SELECT audit_verify_chain();` recomputes the chain and returns the
  sequence number of the first broken event, or nothing if it's intact.

## Steps

1. Check out the branch, install and migrate:
   ```powershell
   git checkout claude/issue-25-idempotency-audit
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   ```
2. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass. The new ones check the chain links, that UPDATE,
   DELETE and TRUNCATE fail, that a tampered event is detected, and the
   idempotency rules.
3. Optional: see it in the database:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "SELECT audit_verify_chain();"
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "DELETE FROM audit_event;"
   ```
   **Expect:** the first prints an empty result (the chain is intact; there
   are no events yet). The second fails with `The audit log is append-only`.

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **Audit events contain no personal data.** The API redacts it before
  writing (#34); `metadata` is for IDs and outcomes only.
- **`db:reset` still works** because it drops the whole database; the
  append-only rules protect the table's contents, not the database itself.
- **Nothing writes audit events yet.** That starts with #34 (audit service)
  and the API features.
