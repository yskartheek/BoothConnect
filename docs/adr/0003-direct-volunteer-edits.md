# ADR-0003: Volunteers edit details directly, with no approval step

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** Product owner (yskartheek)
- **Related:** spec v1.1 "Product decisions", `docs/design/volunteer-app-mockups.html`, #22 #23 #39 #40 #43 #64 #65 #67 #75

## Context

The first version of the spec stored every volunteer change as a _proposed_
value that a reviewer had to _verify_, and sent conflicting offline edits to a
review queue. Reviewing the mockups, the product owner confirmed that there is
no approval flow: booth volunteers own the data for their booth. Volunteers
also need to record more than the official voter list holds: address
components, household location, occupation, caste/community and additional
info. They also need to add households and members that aren't on the list.

## Decision

A volunteer's edit becomes the **current value** straight away. The official
imported values (`voter.source_data`) are still never overwritten. Every
change is a new `field_value` row that supersedes the previous one, so the
full history (who, when, what) is kept and audited.

When two offline edits to the same field collide (same `base_version`), the
server keeps both and marks a conflict. The volunteer resolves it on the phone
by choosing a value (`POST /v1/conflicts/:id/resolve`). There is no reviewer
queue.

Caste/community is enabled as a **consent-gated** field: it is hidden until
the voter agrees, the consent record is stored with the value, it is visible
only to authorised roles, and analytics on it are aggregated and thresholded.
Religion and political affiliation stay disabled.

## Alternatives considered

| Option                                  | Why not                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Proposed → verified with a review queue | The team has no reviewers for booth data; it would block field work.    |
| Last write wins on conflicts            | Silently discards a volunteer's change, which the spec forbids.         |
| Overwrite official data in place        | Loses the official baseline and makes re-importing a newer roll unsafe. |

## Consequences

- Simpler schema and UI: no `verification_status`, no review screens in
  Milestone 1.
- Data quality now depends on volunteers. Admins see who changed what in the
  voter record view and audit log, and can correct values themselves.
- The mobile app needs a "Choose value" flow. Conflicts should be rare because
  each booth normally has one volunteer.
- Collecting caste/community carries legal risk. The §22 legal review must be
  completed before launch, and the field can be switched off in configuration
  without a code change.
