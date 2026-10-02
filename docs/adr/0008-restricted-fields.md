# ADR-0008: Restricted fields are off by default, and can only be enabled with consent and a legal basis

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Product owner (yskartheek)
- **Related:** ADR-0003, ADR-0005, spec §22 (legal review), #23 #24 #40 #113 #114, `apps/api/src/authz/restricted-fields.ts`

## Context

Some details a campaign might want are sensitive personal data:
caste/community, religion and political affiliation. Collecting them can be
unlawful or need explicit consent, depending on the jurisdiction (the
deployment country and law are still open decisions, plan §11). If
collected, they must be seen by as few people as possible and never leak
into lists, exports or small analytics groups.

The product owner decided (spec v1.1, ADR-0003) that caste/community may be
collected **with the voter's consent**, and that religion and political
affiliation are not collected.

The question is how to make that safe by construction, so that a
configuration mistake or a missing check can't start collecting or
exposing such a field.

## Decision

**A field can be marked restricted. Restricted fields are disabled by
default. The database refuses to enable one unless it requires consent and
has a written legal basis. Every value of a consent-gated field must point
to a granted consent from that person, for that purpose.**

- **Definition** (`field_definition`): `is_restricted`, `enabled` (default
  **false**), `requires_consent`, `purpose` (shown in the notice), and
  `legal_basis`.
- **Enabling is gated in the database:** a check constraint refuses
  `is_restricted AND enabled` unless `requires_consent` is true and
  `legal_basis` is non-empty. Turning a field on is a deliberate,
  reviewable change.
- **Writing is gated in the database:** a trigger on `field_value` refuses
  a value for a disabled field, and refuses a value of a consent-gated
  field without `consent_id`. `assert_consent_covers` then checks that the
  consent is **granted**, for **this field's purpose**, and given by **this
  voter** (or their earlier record, ADR-0005) or this household. The API
  reports these as `FIELD_DISABLED` and `CONSENT_REQUIRED`.
- **Consent first.** The apps record the consent (`consent.capture`:
  purpose, notice version, in person) before the value, and the notice
  shown to the voter is versioned.
- **Who sees restricted values:** volunteers, who collect them, and
  admins, who correct them (`RESTRICTED_FIELD_ROLES`). Other roles
  (campaign managers) don't see them. Analytics don't break anything down
  by a restricted field today. If they ever do, it's aggregates only, with
  groups smaller than 10 suppressed, like the rest of analytics. Values
  covered by a withdrawn consent stop syncing, and phones are told to
  delete them.
- **The mobile app keeps no restricted values on the phone.** A
  caste/community value is queued for upload only, and a pull deletes
  restricted values even if the server sends them (#114). A lost phone
  doesn't carry them.
- **Today's configuration:** caste/community is enabled behind consent;
  religion and political affiliation are present but disabled. The seed's
  `legal_basis` says "DEVELOPMENT SEED ONLY": the spec §22 legal review must
  replace it before production.

## Alternatives considered

| Option                                           | Why not                                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Don't model sensitive fields at all              | The product owner wants caste/community with consent. Leaving it out would push it into free-text notes, with no consent and no protection.                                |
| Enforce only in the API                          | One missed check, a script or a future service writing directly would bypass it. The database is the last line, and it's tested.                                           |
| A separate encrypted store for restricted values | Stronger isolation, but more moving parts for Milestone 1. Column-level encryption can be added to `field_value` for restricted fields later, without changing this model. |
| Hide restricted values from volunteers too       | The volunteer who collected the value needs to correct it on the doorstep. The phone still doesn't keep it.                                                                |

## Consequences

- Turning on a restricted field needs a migration or an admin change that
  sets `requires_consent` and `legal_basis`, which is visible in review and
  in the audit log.
- Every app that writes values must capture consent first, and must handle
  `CONSENT_REQUIRED`.
- Withdrawing consent hides the values (sync, reads), but doesn't delete
  them: field values are append-only (ADR-0005). Erasure on request will
  need its own procedure once retention rules are decided (plan §11).
- **Production is blocked** on the spec §22 legal review: a real
  `legal_basis` for caste/community, or turning it off.
- An area admin sees restricted values for their whole area. If that's too
  wide, restricted visibility can become a separate permission, without
  changing the storage.
