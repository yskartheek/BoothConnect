# ADR-0010: Erasing a person's data on request, in an append-only store

- **Status:** Proposed. It needs the retention decision (spec §22) before it's accepted and built.
- **Date:** 2026-10-02
- **Deciders:** Product owner (yskartheek)
- **Related:** #213, ADR-0005 (official data vs field values), ADR-0006 (offline sync), ADR-0007 (hash-chained audit log), ADR-0008 (restricted fields), spec §21 scenario 8, spec §22

## Context

A voter can now withdraw a consent, themselves (#225) or through their
volunteer or an admin (#213). Withdrawal **stops the use** of the data: the
covered values are no longer returned or synced, phones delete them, and a
new value needs a new consent. But the values are **still stored**:

- field values are append-only (ADR-0005): the database refuses updates
  (other than `is_current` and `conflict_with_id`) and deletes;
- consent records never change except to be withdrawn, and are never
  deleted;
- the audit log is hash-chained (ADR-0007), but holds ids, counts and codes,
  never values.

Data protection law in the deployment country may give a person the right to
have their data erased, and may require deleting data that is no longer
needed. How long each kind of data is kept (retention), and which law
applies, are still open (plan §11, spec §22). Erasure has to fit an
append-only store without breaking history, sync or the audit chain.

## Proposed decision

**Erase by redacting in place, through one audited database procedure: the
row stays (its id, field, dates and who collected it), the value is
replaced with an erasure marker, and nothing else can change it.**

- **What's erased:** on a verified request, a person's consent-gated and
  restricted values (caste / community today), and optionally every value
  collected about them (mobile number, occupation, additional info).
  Official roll data isn't erased here: it comes from the published roll
  and is replaced by the next roll (ADR-0005).
- **How:** a `SECURITY DEFINER` function, e.g.
  `erase_person_values(voter_id, request_ref)`, owned by a role the API
  doesn't use day to day. It sets a transaction-local flag that the
  append-only trigger accepts only for this change: `value` becomes
  `{"erased": true}`, and `is_current` becomes false. Consents keep their
  id, purpose, notice version and dates, and are marked withdrawn if they
  weren't. Every earlier record of the person (their lineage) is included.
- **Who:** an admin starts it from the voter's record with the request's
  reference. Later, a second admin approves it (two-person rule) before it
  runs.
- **Audit:** one `person.erase` event with the voter id, the counts of
  values and consents erased, and the request reference. No values were
  ever in the audit log, so the hash chain is untouched.
- **History:** the admin and volunteer views show "Erased on request ·
  date" in place of each erased value, so the history stays complete
  without the data.
- **Phones:** erased values go out in `removedFieldValueIds` on the next
  pull, as withdrawn ones do today.
- **Backups:** erased data stays in backups until they expire. Backup
  retention must be bounded and written down, so erasure is complete
  within a known time.

## Alternatives considered

| Option                                                                                | Why not                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete the rows                                                                       | Breaks the history chain (`supersedes_id`), sync cursors and every reference to the row (audit events name its id). Nothing would show that something was erased, or when.                               |
| Crypto-shredding: encrypt each person's values with their own key, and delete the key | Strong, and it reaches backups too. But it means key management per person and encryption on every read and write, which is a large change for a few fields. Worth revisiting if erasure becomes common. |
| Withdrawal only (what exists now)                                                     | Stops the use but keeps the data. Probably not enough if the law gives a right to erasure, or for data past its retention period.                                                                        |
| Relax the append-only rule for admins                                                 | Loses the guarantee that history can't be rewritten, which ADR-0005 depends on.                                                                                                                          |

## Consequences

- **Decisions needed first (spec §22):**
  - retention per kind of data;
  - whether erasure covers all collected values or only consent-gated and restricted ones;
  - who may approve;
  - how a request is verified (in person, through the voter app);
  - the backup retention period.
- **To build once accepted:**
  - a migration (the function, the role, the trigger change);
  - an admin action with approval;
  - "Erased on request" in the views;
  - sync removal;
  - tests showing the value is gone from every table and read path while the history and audit chain stay valid.
- **Retention-based deletion** (data past its period) can use the same
  procedure, run on a schedule rather than on request.
- **What would make this wrong:** if the law requires erased data to leave
  backups at once, or if requests become frequent, crypto-shredding becomes
  the better choice.
