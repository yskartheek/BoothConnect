# ADR-0005: Official data stays as imported; everything else is an append-only field value with its provenance

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Product owner (yskartheek)
- **Related:** ADR-0003 (direct edits, no approval), #22 #23 #40 #113 #161, `apps/api/src/field-values/`

## Context

A voter's details come from two places:

- **The official electoral roll**, imported from PDFs: name, relative's
  name, age, gender, EPIC number, house number, section and serial. It is
  the legal baseline, and a newer revision of the roll replaces it.
- **The field**: volunteers correct a misspelt name, add a mobile number,
  an occupation, caste/community with consent, a household's address and
  location. They add members and households that aren't on the roll. Admins
  correct values too.

ADR-0003 decided that a volunteer's edit applies at once, with no reviewer.
This ADR records **how** both kinds of data are stored, so that:

- the official record is never lost or blurred with field data;
- every value says who collected it, when, how and under which consent;
- nothing is ever overwritten, so history and conflicts can be shown;
- a new roll revision doesn't wipe what volunteers collected.

## Decision

**Two layers: the official record, frozen at import, and field values on
top. A field value is a new row for every change, never updated in place.**

- **Official layer.** `voter.source_data` (JSON) holds the record as
  imported, with its source revision, file and position. A database trigger
  (`voter_protect_source`) refuses any change to them. Fields the roll
  doesn't have, and members volunteers add (`origin = volunteer_added`),
  have no `source_data`.
- **Field layer.** `field_value` holds one row per value:
  - `entity_type` + `entity_id` (a voter or a household), and the field
    (`field_definition_id`): what the admin configured, e.g.
    `mobile_number`, `caste_community`, `address`, `household_location`;
  - `value` (JSON, checked against the field's type and options);
  - **provenance**: `source_type` (`official_import`, `volunteer_collected`,
    `admin_corrected`, `voter_self_submitted`, `derived`), `collected_by`,
    `collected_at`, and `consent_id` for consent-gated fields (ADR-0008);
  - **history**: `supersedes_id` (the value it replaces), `is_current`,
    `base_version` (the value the client last saw), `conflict_with_id`
    (two colliding edits; see ADR-0006), and `carried_from_id` (see below).
- **Append-only, in the database.** Triggers refuse `DELETE` and any
  `UPDATE`, except the two moves that settle history: `is_current` going
  from true to false, and clearing `conflict_with_id` when a volunteer
  chooses. A change is always a new row that supersedes the old one.
- **The current value** of a field is its current `field_value`. If there
  is none, it's the official value from `source_data`. Two values are both
  current only while a conflict is open. The API's voter record shows the
  official values, the current values and the whole history side by side.
  The mobile app reads them the same way.
- **New roll revisions** (#161): a voter in the new revision is linked to
  their previous record by EPIC, when the EPIC appears once in each. The
  current field values, open conflicts and granted consents are copied to
  the new record, each copy pointing back with `carried_from_id`.
  `voter_lineage()` follows the chain. A withdrawn consent is never revived.
- **Audit.** Each write is also an audit event (ADR-0007) with ids and
  counts only; the values themselves live in `field_value`.

## Alternatives considered

| Option                                                       | Why not                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit the voter row in place                                  | Loses the official baseline. A re-import would overwrite volunteer work, or volunteer work would hide what the roll says.                                                 |
| A column per field on `voter` / `household`                  | Every new field is a migration and an app release, and per-value provenance (who, when, consent) would need a column per field too. Admins can't add or turn off a field. |
| A separate audit/history table, with current values in place | Two sources of truth to keep in step. History, conflicts and provenance would all live outside the data itself.                                                           |
| Event sourcing for all records                               | More than Milestone 1 needs. Field values already give an append-only history where it matters, and the rest of the schema stays conventional.                            |

## Consequences

- Reading a voter means combining `source_data` with the current values.
  The API (`voters.service.ts`, sync) and the mobile app (`local_reads.dart`)
  each do this in one place.
- The table only grows. One row per change is small, and it's indexed on
  current values only (`field_value_current_idx`). Archiving superseded
  values of old programs can come later.
- Removing a value isn't possible: an emptied detail keeps its value (the
  apps say so). A real "clear" would be a new value meaning empty, if ever
  needed.
- Linking by EPIC across revisions misses voters whose EPIC changed or
  appears twice. They start fresh, and their old record keeps its history.
- A wrong official value is corrected with a field value
  (`admin_corrected`), never by editing the import.
